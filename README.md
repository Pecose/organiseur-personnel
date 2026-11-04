# organiseur-personnel

Application personnelle iPhone **PWA**, en cours de conception. Installation via GitHub Pages, sauvegardes légères prévues sur Firebase Spark, **synchronisation bidirectionnelle Google Agenda prévue**, bibliothèque multimédia locale. **Objectif : 0 €**.

## Documentation du projet

- **[AGENTS.md](AGENTS.md)** : consignes obligatoires pour les agents IA. **À lire avant toute modification.**
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** : **registre central contractuel** des fichiers, objets, fonctions, signatures, entrées/sorties, dépendances, relations et connexions.
- **[ROADMAP.md](ROADMAP.md)** : tableau de bord des objectifs **G01–G14**, liens vers les contrats architecturaux, phases de développement et tests.

> **Règle bloquante :** tout élément absent ou incompatible avec le registre d'architecture doit être soumis à l'utilisateur. Après accord explicite, la documentation d'architecture doit être mise à jour et committée **avant** le code. Pas d'ajout implicite.

**État au 3 novembre 2026 :** 35 objets S0–S4 typés, fondations S5 et opérations S6 codées partiellement, cinq écrans et vues médias S7 en TypeScript natif, et **trois ajustements S8/D24 codés** : reports groupés de tâches oubliées, validation automatique par occurrence avec transactions Firestore, bilan mensuel filtrable accessible depuis Paramètres. L'interface ne remplace aucune donnée par défaut et les fichiers personnels restent locaux. **Code S5–S9 non testé et non déployé**, conformément à D23 : compilation du dépôt, émulateurs Firebase deux UID, transactions concurrentes, Safari iPhone, offline et VoiceOver à vérifier en recette finale. Aucune configuration Firebase réelle appliquée, aucune donnée privée modifiée, aucune facturation activée. **S9 démarrée uniquement en préparation** : M75 (permission Push à la demande), M81 (réception Push minimaliste), M118 (classement des erreurs Google). Les connexions Google Agenda, les abonnements VAPID et le Worker Cloudflare restent à concevoir et autoriser concrètement avant implémentation ; **S10 reste à développer**.

## Organisation de l'interface (S7)

L'application a désormais cinq onglets fixes, accessibles à une main : **Calendrier · Tâches · Jour · Habitudes · Listes**. Jour est l'accueil et présente uniquement **sans horaire** puis **avec horaire**. La semaine du calendrier affiche lundi à samedi (3×2) et un dimanche dépliable. L'icône gauche ouvre une fiche unique ; la validation à droite porte sur l'occurrence du jour.

Sans configuration Firebase réelle, le shell montre uniquement des états vides et une invitation à se connecter, **jamais des données de démonstration présentées comme personnelles**. Les interfaces Musique, Décoration et Paramètres sont secondaires et encore incomplètes. La route Bilan mensuel attend la strate S8. La validation d'une tâche **sans date** nécessite une décision d'architecture complémentaire, puisqu'une coche O33 demande une occurrence datée.

Les tests et la compilation sont **expressément remis à la recette finale D23** : les commandes ci-dessous décrivent comment les effectuer alors, et non des validations déjà réussies.

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
