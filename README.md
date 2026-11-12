# organiseur-personnel

Application personnelle iPhone **PWA**, en cours de conception. Installation via GitHub Pages, sauvegardes légères prévues sur Firebase Spark, **synchronisation bidirectionnelle Google Agenda prévue**, bibliothèque multimédia locale. **Objectif : 0 €**.

## Documentation du projet

- **[AGENTS.md](AGENTS.md)** : consignes obligatoires pour les agents IA. **À lire avant toute modification.**
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** : **registre central contractuel** des fichiers, objets, fonctions, signatures, entrées/sorties, dépendances, relations et connexions.
- **[ROADMAP.md](ROADMAP.md)** : tableau de bord des objectifs **G01–G14**, liens vers les contrats architecturaux, phases de développement et tests.

> **Règle bloquante :** tout élément absent ou incompatible avec le registre d'architecture doit être soumis à l'utilisateur. Après accord explicite, la documentation d'architecture doit être mise à jour et committée **avant** le code. Pas d'ajout implicite.

**État au 4 novembre 2026 :** 35 objets S0–S4 typés, fondations S5 et opérations S6 codées partiellement, cinq écrans et vues médias S7 en TypeScript natif, et **trois ajustements S8/D24 codés** : reports groupés de tâches oubliées, validation automatique par occurrence avec transactions Firestore, bilan mensuel filtrable accessible depuis Paramètres. L'interface ne remplace aucune donnée par défaut et les fichiers personnels restent locaux. **Code S5–S9 non testé et non déployé**, conformément à D23 : compilation du dépôt, émulateurs Firebase deux UID, transactions concurrentes, Safari iPhone, offline et VoiceOver à vérifier en recette finale. Aucune configuration Firebase réelle appliquée, aucune donnée privée modifiée, aucune facturation activée. **S9 en développement, non testée** : la décision D25 a autorisé les routes Worker et la protection des jetons. Le code F37/F45/F46 prépare OAuth Google distinct de Firebase, première synchronisation prudente des événements horaires et arbitrage des conflits. F33/F19 prépare les gestes de permission, abonnement et retrait Push ainsi que le test côté PWA. **L'envoi Web Push distant, l'ordonnanceur Cron et la synchronisation Google lorsque l'application est fermée ne sont PAS opérationnels**. F38 est non déployé, aucune clé VAPID réelle ni secret Google n'a été fourni ; aucune connexion externe ni paiement activé. **S10 reste à développer**.

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

**Dernier lot S9B (5 novembre 2026) :** le Worker inclut maintenant une implémentation préparatoire de VAPID ES256 et du chiffrement Web Push RFC8291, ainsi que le verrou Firestore destiné à éviter les tests de notification répétés. **Les notifications distantes restent désactivées dans le code**, et aucun test, Cron, déploiement, secret ni coût n'a été engagé.

**S9B, moteur Cron du 5 novembre 2026 :** les fonctions M84–M88 sont préparées dans le Worker pour sélectionner les rappels, les réserver avec un reçu Firestore anti-doublon, envoyer un Web Push chiffré et journaliser le résultat. Le scan est borné à 80 rappels au total et trois candidats par passage. Les notifications restent **totalement désactivées dans le code** (`CRON_SECURITY_APPROVED=false`), sans déploiement, secret ou facturation ; leur sécurité et compatibilité iPhone doivent être éprouvées pendant la recette finale.

**Durcissement S9 (5 novembre 2026) :** relecture des rappels et abonnements avant Push, précondition de version sur le reçu du test et sur le curseur Google Agenda pour limiter les écrasements concurrents. Ces garde-fous ne garantissent pas encore une transaction atomique entre l'annulation d'un rappel et son envoi. Le développement de M114 (Google Agenda en PWA fermée) reste différé ; aucune permission, facturation, activation ni recette finale n'a été engagée.

**Développement S9B/S7, 5 novembre 2026 :** une transaction Firestore relie désormais la relecture du rappel O06 à la réservation anti-doublon O19 ; les playlists peuvent recevoir, perdre et réordonner des titres et être supprimées sans supprimer les MP3. L'écran « Ma musique » expose ces commandes avec confirmation de suppression. La synchronisation Google fermée et la suppression définitive de médias restent à traiter ; les sauvegardes ont depuis été codées sous le contrat D26, sans recette. Tout demeure non testé, sans Cron actif, sans déploiement ni facturation.

**Google Agenda, résolution des conflits (5 novembre 2026) :** l'arbitrage « local / Google / les deux » est préparé dans un commit Firestore atomique avec contrôle des versions et gestion d'une seule liaison Google par événement conservé. Le résultat n'a pas été testé sur Google réel et la synchronisation en application fermée est encore différée. Services et Cron restent inactifs.

**S10/D26, 6 novembre 2026 (CODE, PAS ENCORE VALIDÉ) :** quatre types techniques `BackupScope`, `RestoreReport`, `CropRect`, `DecorLayer` ont été approuvés et inscrits d'abord dans `docs/ARCHITECTURE.md`. F34 `src/services/backup.ts` implémente M70–M74 : export JSON O16 des seules collections métier du compte, empreinte SHA-256, refus d'un autre UID, restauration par transactions Firestore (fusion sans écraser, remplacement explicite par ID sans purge), archive multimédia O21 sans dépendance tierce conservant les ID locaux O10, import IndexedDB sans écrasement de fichiers différents. **Deux sauvegardes distinctes sont nécessaires** pour retrouver les données et les fichiers personnels sur un nouvel iPhone. Le JSON n'est pas chiffré : le conserver dans un lieu privé, jamais sur GitHub. La restauration de documents est atomique par ID, pas sur l'ensemble du fichier ; si elle échoue, il faut contrôler les écritures précédentes. Dans F19/Paramètres, les commandes sont manuelles : choisir le fichier et confirmer avant restauration, puis toucher le lien de téléchargement pour enregistrer dans Fichiers (comportement Safari à tester). F26/M97–M98 prépare le recadrage carré et les fonds PNG portrait 1080×1920 avec texte facultatif, accessibles depuis la galerie ; les originaux sont préservés et le fond n'est pas encore appliqué comme thème O07. **M82/M83, les thèmes, la synchronisation Google fermée et tous les tests D23 restent à réaliser.** Aucun Firebase, Cron, facturation ou déploiement activé.

**Lot de code du 12 novembre 2026 (NON TESTÉ / NON DÉPLOYÉ)** : F36 `src/pwa/update.ts` implémente M82/M83 pour consulter la version O17 publiée dans `manifest.webmanifest` puis activer une mise à jour seulement après confirmation dans Paramètres F19. F35 n'appelle plus `skipWaiting()` automatiquement au remplacement du worker ; seule une demande de mise à jour explicite active le worker en attente. Les caches supprimables restent exclusivement `organiseur-shell-*` : aucun IndexedDB ni Firestore n'est effacé. Les trois références de version (package, état embarqué, manifeste) sont alignées à 0.1.1 / s10-1. F24 ajoute M93 **uniquement pour le retrait des métadonnées d'un morceau importé** et le nettoyage de ses playlists ; le fichier reste local. M49/M69 et la branche d'effacement physique de M93 restent BLOQUÉES pour éviter toute suppression d'un média référencé sur un autre appareil ou compte. M52 vérifie désormais le titre avant de stocker le Blob. F19 rend les actions visibles, toujours sans exécuter de tests, installer la PWA, configurer Firebase ou publier Pages. **M66/M68/M96 (thèmes et fond appliqué), M114 (Google Agenda PWA fermée), les icônes PWA F10 et la recette D23 restent ouverts.** La version 0.1.1 désigne le **code**, pas une application livrée. Aucun paiement, secret, donnée personnelle ou service externe activé.

Le fichier `tests/security.test.ts` contient le scénario T05 : deux UID distincts, refus de lecture/écriture croisée, blocage des jetons Google et des reçus serveur. Il **n'est pas exécuté automatiquement** et n'utilise **que les émulateurs locaux Firebase**, avec `FIREBASE_EMULATOR_TEST=1`. Un test ignoré ne constitue pas une validation. Aucun paquet Firebase CLI additionnel n'a été ajouté au projet par cet accord.

**Propriétaire :** `Pecose`. Indépendant de tout dépôt `T-C-Umbral`.
