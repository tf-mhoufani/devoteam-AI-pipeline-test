# Devoteam AI pipeline

Test technique : analyser des logs d’infra (`data/rapport.json`), produire un rapport structuré (`report/output.json`) avec insights, anomalies détectées et recommandations DevOps.

Les métriques et anomalies sont calculées en code déterministe. Groq ne sert qu’à proposer des actions correctives, dans le schéma de sortie attendu.

## Démarrage rapide

**Prérequis** : Node.js 20+, clé [Groq](https://console.groq.com/) (`GROQ_API_KEY`).

```bash
npm install
```

Crée un `.env` à la racine (ne pas le committer) :

```env
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-20b
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_BATCH_PAUSE_MS=2000
GROQ_MAX_RETRIES=3
```

```bash
npm start
# équivalent :
npm run analyze-logs -- --input ./data/rapport.json --output ./report/output.json
npm test
```


| Option / env                      | Défaut                 | Rôle           |
| --------------------------------- | ---------------------- | -------------- |
| `-i` / `--input` / `INPUT_LOGS`   | `./data/rapport.json`  | logs source    |
| `-o` / `--output` / `OUTPUT_JSON` | `./report/output.json` | rapport généré |


Les fichiers dans `report/` sont gitignorés.

## Pipeline

```
data/rapport.json
        │
        ▼
  logAnalyzer (CLI) — loadJson + Zod
        │
        ▼
  pipe(PartialAnalysisReport)
        │
        ├─ aggregateInsights      (déterministe)
        ├─ detectAnomalies        (déterministe)
        └─ generateRecommendations (Groq — voir section suivante)
        │
        ▼
  writeJson + OutputSchema → report/output.json
```

1. **Charge** les logs et les valide (`logEntrySchema`).
2. **Agrège** sur toute la fenêtre : latence moyenne, CPU / mémoire max, error rate moyen, uptime max, statuts de service (un service peut apparaître online et offline s’il a basculé).
3. **Détecte** les pics :
  - CPU ≥ 85 % (medium) / ≥ 95 % (high)
  - latence ≥ 250 ms (medium) / ≥ 350 ms (high)
  - error rate ≥ 0,05 (high)
4. **Recommande** via Groq (détail ci-dessous). Les **163 anomalies** restent toutes dans le JSON ; seules les recos sont condensées.
5. **Écrit** un `AnalysisReport` : `timestamp`, `insights`, `anomalies`, `recommendations`, `service_status_summary`.

Les cibles des recos sont limitées aux services observés (`database`, `api_gateway`, `cache`).

## Recommandations Groq

### Provider et modèle

- **Groq** : API compatible OpenAI → client `openai` + `GROQ_BASE_URL`, compte **gratuit** suffisant pour ce test.
- `**openai/gpt-oss-20b**` : supporte `json_schema` + `strict: true` (requis pour contraindre la sortie). Assez capable pour des recos DevOps courtes une fois le prompt cadré.
- **Structured Outputs** : Zod génère le JSON Schema (`z.toJSONSchema`) envoyé à Groq ; le parser applique `safeParse` en retour.
- **Quota free tier (8k TPM)** : voir [Throttling et résilience API](#throttling-et-résilience-api) ci-dessous.

### Throttling et résilience API

**Étalement des appels (batching temporel)**  
Les appels Groq sont **séquentiels**, pas parallèles : pause de 2 s entre chaque job (`GROQ_BATCH_PAUSE_MS`, défaut 2000 ms) pour limiter le débit tokens/minute sur le free tier (8k TPM). Ce n’est pas un « lot de N anomalies par requête » : chaque appel porte un **groupe métrique** ou un **bloc statuts**. L’objectif est d’éviter les 429 en espaçant les requêtes.

**429 (rate limit)**  
Si Groq renvoie un 429, le middleware attend le délai indiqué (`retry-after` ou message « try again in Xs »), puis réessaie jusqu’à `GROQ_MAX_RETRIES` (défaut 3). Budget de retries **séparé** des erreurs schema. Si le 429 persiste, le job est **ignoré** (recos vides pour ce groupe) et le pipeline continue.

**400 (JSON schema / génération tronquée)**  
Groq peut répondre 400 avec `json_validate_failed` quand la sortie ne respecte pas le schéma strict — souvent parce que la génération a été **coupée** (`max_tokens: 2048`) ou que le quota limite la réponse. Le client tente alors :

1. **Récupérer** le JSON partiel dans `failed_generation` (si parseable → recos extraites -> coût 0 tokens) 
2. **Réessayer** le job (jusqu’à `GROQ_MAX_RETRIES`) si `failed_generation` est vide ou JSON tronqué illisible
3. **Ignorer** le groupe si les retries échouent

Les compteurs 429 et schema sont **indépendants** : un 429 après des 400 ne consomme pas le budget schema, et inversement.

### Workflow en deux passes

Le middleware sépare **détection** (liste complète des pics) et **recommandation** (quelques actions pour un CTO).

**Passe 1 — génération (brouillons)**

Chaque appel Groq est isolé ; le modèle ne voit pas les recos des appels précédents.


| Étape              | Contenu envoyé                                                             | Objectif                                             |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1 appel / métrique | Résumé du groupe (`count`, `min`, `max`, `bySeverity`, 2 pires `examples`) | 1–2 recos par type de pic (CPU, latence, error rate) |
| 1 appel statuts    | Services `degraded` / `offline`                                            | 1 reco par service à remettre d’aplomb               |


**Pourquoi grouper par métrique ?** Sur le jeu d’exemple, 163 pics = 3 métriques. Envoyer chaque pic impliquerait ~17 appels, beaucoup de tokens et des recos répétitives. Groq reçoit l’ampleur (`count: 49`) sans lire 49 lignes. Le groupement ne sert qu’au prompt.

**Passe 2 — synthèse**

Un dernier appel reçoit tous les brouillons + insights + `service_status_summary`. Il ne crée pas de nouvelles actions : il **fusionne** les doublons sémantiques (ex. `increase_ttl` et `increase_cache_ttl` à 3600 s) et **range** par criticité :

1. restore **offline**
2. stabiliser **degraded**
3. optimisations **métriques**

Si la synthèse renvoie une liste vide, les brouillons sont conservés.

Résultat typique : ~5 appels Groq, 6–7 recos finales au lieu de 146 quasi identiques.

## Choix techniques

Stack habituel (Node + TypeScript, back et front depuis ~9 ans) : typage strict, CLI Node, validation compile-time, sans surcouche.


| Choix                 | Pourquoi                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js 20+**       | Runtime adapté à un CLI JSON + appels HTTP.                                                                                                                                |
| **TypeScript 6**      | Contrat sur le pipe (`PartialAnalysisReport` → `AnalysisReport`), aliases `#`. `npx tsc --noEmit` sans build JS. TS 7 écartée : `typescript-eslint` pas encore compatible. |
| **Zod 4**             | Valider entrée/sortie, inférer les types (`z.infer`), parser Groq (`safeParse`), générer le JSON Schema (`z.toJSONSchema`) — un seul contrat.                              |
| **tsx**               | Exécution directe du CLI (`tsx --env-file=.env`).                                                                                                                          |
| **SDK OpenAI**        | Point d’accès Groq ; `maxRetries: 0`, gestion 429/400 dans `services/groq`.                                                                                               |
| **Vitest**            | API proche de Jest ; ESM natif, aliases `#`, mock Groq (`vi.mock` + `await import`) sans config lourde. Couverture 85 % sur les middlewares.                               |
| **ESLint + Prettier** | Lint TS + formatage.                                                                                                                                                       |


### Middlewares, pas LangGraph

Flux linéaire : charger → agréger → détecter → recommander → écrire. `pipe(step, step, step)` suffit ; pas de graphe, agent loop ou tool-calling. LangGraph ajouterait complexité et dépendances pour un problème que des middlewares testables isolément résolvent déjà.

Patterns retenus : **strategy** pour insights/anomalies, **service réutilisable** pour Groq, **helpers** (`pipe`, `loadJson`, `writeJson`), dossier par étape avec `index.ts` = re-export.

### Couche service Groq

Le client Groq est extrait du middleware recommandations pour montrer une séparation **transport / métier** :

```
generateRecommendations ──► services/groq ──► Groq API
         (prompts, grouping)     (429, retries, structured chat)
```

- **`src/services/groq`** : client OpenAI, pause entre appels, retries 429/400, structured outputs générique (`responseFormat` + `parse` injectés).
- **`src/middlewares/generateRecommendations`** : regroupement anomalies, prompts DevOps, synthèse — consomme le service via un wrapper mince (`requestRecommendations.ts`).

Un autre middleware pourrait réutiliser `requestGroqWithRetry` avec un autre schéma JSON sans dupliquer la gestion quota.

## Structure du repo


| Dossier                      | Rôle                         |
| ---------------------------- | ---------------------------- |
| `src/scripts/logAnalyzer.ts` | orchestrateur CLI            |
| `src/middlewares/*`          | une étape du pipe            |
| `src/services/groq`          | client Groq réutilisable     |
| `src/helpers/*`              | utilitaires partagés         |
| `src/types/schema.ts`        | contrats Zod + types inférés |
| `data/`                      | logs d’entrée                |
| `report/`                    | sorties générées             |


