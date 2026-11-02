# organiseur-personnel

Application personnelle iPhone **PWA**, en cours de conception. Installation via GitHub Pages, sauvegardes légères prévues sur Firebase Spark, **synchronisation bidirectionnelle Google Agenda prévue**, bibliothèque multimédia locale. **Objectif : 0 €**.

## Documentation du projet

- **[AGENTS.md](AGENTS.md)** : consignes obligatoires pour les agents IA. **À lire avant toute modification.**
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** : **registre central contractuel** des fichiers, objets, fonctions, signatures, entrées/sorties, dépendances, relations et connexions.
- **[ROADMAP.md](ROADMAP.md)** : tableau de bord des objectifs **G01–G14**, liens vers les contrats architecturaux, phases de développement et tests.

> **Règle bloquante :** tout élément absent ou incompatible avec le registre d'architecture doit être soumis à l'utilisateur. Après accord explicite, la documentation d'architecture doit être mise à jour et committée **avant** le code. Pas d'ajout implicite.

**État au 3 novembre 2026 :** les 35 objets S0–S4 sont typés ; **S5 est en cours**. Vite/TypeScript, Firebase SDK modulaire (Auth/Firestore), une page d'attente, un manifeste et un service worker de cache public sont en place **dans le code**, mais aucun écran métier, aucune installation iPhone validée et aucun déploiement Firebase ne sont revendiqués. Les règles Firestore existent **sans avoir été activées ni validées dans l'émulateur**. Google Agenda et notifications distantes restent planifiés.

## Construire le projet (Node 22.12+ ou 24+)

```bash
npm install
npm run typecheck
npm run build
npm run preview
```

Le site Vite utilise la base de chemin **`/organiseur-personnel/`**, nécessaire pour une éventuelle publication sous GitHub Pages. `dist/` est un résultat de compilation, **pas un dossier à versionner**. Aucun workflow de déploiement GitHub Actions n'est actuellement enregistré ni activé.

### Configuration publique Firebase

La page ne tentera pas d'initialiser Firebase si les quatre valeurs publiques indispensables ne sont pas définies dans l'environnement Vite :

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Options si fournies par Firebase : `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_STORAGE_BUCKET`. Utiliser **uniquement les paramètres réels du projet Firebase**, jamais des valeurs d'exemple sur le site public. Les identifiants de configuration Web ne remplacent **jamais** les règles Firestore F39, qui doivent être testées puis déployées séparément. Ne publier **aucun** mot de passe, clé de service, jeton OAuth ni fichier personnel.

Le cache Firestore persistant est **soumis à la confirmation que l'appareil est personnel et fiable**. En cas de refus, cache mémoire seulement. La PWA et la musique en arrière-plan nécessitent toujours des essais sur un vrai iPhone.

### Contrôles de sécurité restants

Le fichier `tests/security.test.ts` contient le scénario T05 : deux UID distincts, refus de lecture/écriture croisée, blocage des jetons Google et des reçus serveur. Il **n'est pas exécuté automatiquement** et n'utilise **que les émulateurs locaux Firebase**, avec `FIREBASE_EMULATOR_TEST=1`. Un test ignoré ne constitue pas une validation. Aucun paquet Firebase CLI additionnel n'a été ajouté au projet par cet accord.

**Propriétaire :** `Pecose`. Indépendant de tout dépôt `T-C-Umbral`.
