# AGENTS.md — Instructions obligatoires pour toute IA intervenant sur ce dépôt

> Ce fichier est **l'entrée canonique des instructions** pour les agents de développement sur `Pecose/organiseur-personnel`. Il s'applique à **tout le dépôt**, tous les sous-répertoires et toutes les interventions (lecture, correction, refactorisation, ajout, suppression, migration, documentation ou déploiement).

## PREMIÈRE INSTRUCTION — LIRE L'ARCHITECTURE, PUIS AGIR

**Avant d'écrire/modifier/supprimer le moindre fichier, l'agent DOIT :**

1. Lire **entièrement** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), **registre unique et normatif** de l'arborescence cible, des objets, des fonctions, des signatures entrée/sortie, des dépendances, des relations, des connexions externes et des flux.
2. Lire [`ROADMAP.md`](ROADMAP.md), **en particulier le tableau de bord G01–G09** reliant objectifs humains, objets/fonctions/connexions, tests et état de réalisation.
3. Examiner les fichiers **réellement présents** dans le dépôt et distinguer les éléments `PLANNED` des éléments `IMPLEMENTED`. Ne pas confondre architecture projetée et code existant.
4. Identifier les références exactes concernées : **G** (objectifs de la roadmap), **F** (fichiers), **O** (objets), **M** (fonctions), **C** (connexions), **FL** (flux), **D** (décisions) et **T** (tests).
5. Vérifier les entrées, sorties, consommateurs, dépendances, schémas, effets sur stockage, sécurité, coûts et compatibilité iPhone **avant** de proposer ou d'exécuter la moindre modification.

**Si le document d'architecture manque, est inaccessible, ambigu ou contradictoire avec le code : STOP.** Signaler le problème et demander la décision de l'utilisateur.

## RÈGLE ABSOLUE : AUCUN ÉLÉMENT HORS ARCHITECTURE SANS ACCORD

Il est **INTERDIT** de créer, déplacer, supprimer, renommer ou changer le contrat d'un élément qui ne figure pas déjà de manière compatible dans `docs/ARCHITECTURE.md` sans accord préalable explicite de l'utilisateur.

Cela inclut notamment :
- un **fichier**, dossier, module, classe, interface, type, objet ou champ structurant ;
- toute **fonction/méthode**, même « helper », et sa signature, paramètres, retour ou effets de bord ;
- toute **dépendance**, import transversal, librairie externe, branche de communication ou API ;
- tout **store/collection/table**, événement, message, service, autorisation, Worker ou connexion ;
- toute nouvelle relation entre objets ou changement de dépendances ;
- tout changement de périmètre produit, de coût, de distribution, de schéma ou de stratégie de synchronisation.

**En cas d'élément absent ou incohérent : ne pas coder, ne pas créer un fichier "temporaire", ne pas improviser d'alternative. ARRÊTER LE TRAVAIL concerné et REMONTER À L'UTILISATEUR.**

### Message de blocage obligatoire

> **⛔ ARRÊT — Élément absent de l'architecture**
>
> **Tâche demandée :** …
> **Élément manquant / contradictoire :** …
> **Pourquoi il est nécessaire :** …
> **Proposition de registre :** ID, chemin, rôle, entrées → sorties, appelants, dépendances, nouvelles connexions, schémas et tests.
> **Conséquences :** sécurité, sauvegardes, coût (0 € obligatoire), fonctionnement iOS et autres modules concernés.
>
> **M'autorises-tu explicitement à ajouter ou modifier cet élément dans `docs/ARCHITECTURE.md` ?**
>
> Je n'implémenterai rien concernant cet élément avant ta réponse.

Une demande générale (« fais cette fonctionnalité ») n'autorise **pas implicitement** l'ajout d'objets absents ; obtenir l'accord spécifique au changement d'architecture. **Silence ≠ accord.**

### Après approbation : ORDRE IMPÉRATIF

1. Modifier **d'abord** `docs/ARCHITECTURE.md` : enregistrer la nouvelle entrée et **toutes** ses dépendances, connexions, entrées/sorties, responsabilités, schémas, tests et identifiants stables.
2. **Versionner la modification architecturale dans un commit séparé, avant le code.** Si la plateforme ne permet pas les commits, s'arrêter et expliquer l'impossibilité.
3. Modifier ensuite uniquement les fichiers autorisés par ce registre, dans un second commit, sans s'écarter des contrats.
4. Tester et actualiser l'état `PLANNED`/`IMPLEMENTED`, puis le tableau d'objectifs G01–G09 et les jalons dans `ROADMAP.md`.
5. Fournir un compte rendu clair avec les références impactées et les tests exécutés.

Si le changement demandé **correspond exactement à un élément déjà documenté**, l'agent peut l'implémenter dans le périmètre défini, mais doit respecter la signature, les dépendances et les tests et remettre la documentation à jour. Toute divergence réactive le blocage.

## Invariants non négociables

- **Compte/projet :** `Pecose/organiseur-personnel` uniquement ; **ne jamais écrire dans** `T-C-Umbral`.
- **Budget : 0 €** et **aucune facturation activée**. GitHub Pages public pour la PWA, Firebase Spark pour Auth/Firestore ; Cloudflare gratuit uniquement lors de la phase notifications.
- **PWA Safari/iPhone**, pas de compilation `.ipa`, de compte Apple Developer, de serveur personnel ou de Mac nécessaire.
- **Agenda, tâches et métadonnées** : synchronisation Firestore sous règles `uid` strictes ; **Google Agenda : liaison OAuth distincte et synchronisation bidirectionnelle** (G02/D11–D13), jetons Google protégés côté Worker, conflits explicités ; **musique Suno personnelle et images importées** : stockage local et export/restauration séparés.
- **Aucune clé privée ni donnée personnelle** dans le dépôt public, le JavaScript servi au navigateur ou les journaux. Protéger règles Firestore et secrets Worker.
- **Notifications Web Push ≠ réveils natifs garantis** : ne pas promettre l'heure exacte hors connexion ni contourner les permissions iOS.
- **Google Agenda PWA fermée** : pas de synchronisation à distance tant que le Worker gratuit n'est pas configuré et testé ; la connexion OAuth et la sauvegarde automatique ne doivent pas être confondues. Ne pas activer de service payant.
- **Préserver** les imports personnels, les bases locales et les données cloud lors des mises à jour ; ne pas confondre synchronisation et sauvegarde indépendante.
- Les fichiers prévus dans l'arbre architectural **n'existent pas nécessairement** : vérifier l'état réel du dépôt avant toute affirmation.

## Exécution et qualité

- **Avant l'action :** citer les références architecturales utilisées et signaler toute décision non couverte.
- **Pendant :** changer le minimum nécessaire, typage explicite, validation des entrées, traitement des erreurs, aucune opération réseau cachée.
- **Après :** lancer les tests pertinents enregistrés dans le registre ; tester réellement sur iPhone quand c'est nécessaire (Web Push, audio en arrière-plan, installation PWA, offline).
- **À la livraison :** lister les fichiers modifiés, références de fonctions/objets/connexions concernées, résultats de tests et éventuels blocages.
- Les documents `README.md`, `ROADMAP.md`, `AGENTS.md` et `.github/copilot-instructions.md` **ne doivent pas diverger** : les pointeurs renvoient au seul registre `docs/ARCHITECTURE.md`. L'alias `agent.md` minuscule est supprimé volontairement ; ne pas le recréer.
- Ne jamais affirmer qu'un code, test, compte ou déploiement existe si seule sa spécification existe.

**Hiérarchie de lecture obligatoire :** `AGENTS.md` → **`docs/ARCHITECTURE.md`** → `ROADMAP.md` → code réel → tâche à exécuter. En cas de contradiction, **arrêt et consultation de l'utilisateur**.
