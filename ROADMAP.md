# Roadmap — Application personnelle iPhone (PWA)

> **Statut :** cahier des charges validé pour le démarrage du projet.  
> **GitHub cible :** compte **`Pecose`**, **jamais** l'organisation `T-C-Umbral`.  
> **Dépôt créé :** `Pecose/organiseur-personnel` (public, branche `main`).  
> **Utilisatrice cible :** une personne, sur iPhone.  
> **Budget impératif :** **0 €** d'abonnement, d'hébergement et de compte Apple Developer.  
> **Environnement de développement :** Windows.  
> **Dernière mise à jour :** 1er novembre 2026.

## 1. Vision et décisions actées

Construire un organisateur personnel doux, personnalisable et agréable à utiliser, réunissant :

- un **agenda autonome** (sans synchronisation obligatoire avec le calendrier Apple) ;
- un **gestionnaire de tâches** (priorités, échéances, récurrences) ;
- des **rappels et notifications**, y compris quand l'application est fermée, sous réserve des limites iOS et de la connexion réseau ;
- une **bibliothèque de musiques personnelles Suno**, avec lecteur et playlists ;
- une **bibliothèque d'images** et des thèmes changeant selon les saisons ;
- un **stockage local**, une utilisation hors ligne et une **sauvegarde automatique de l'agenda et des tâches** ;
- une **restauration sur un nouvel iPhone** après reconnexion au compte ;
- un système de **mise à jour** de l'application et de ses médias fournis par défaut depuis GitHub.

### Choix techniques validés

| Domaine | Choix | Pourquoi |
|---|---|---|
| Distribution | **PWA installable sur iPhone via Safari** | Pas de compilation macOS, pas d'IPA ni d'abonnement Apple Developer, pas de renouvellement de signature tous les sept jours |
| Code source | **GitHub, compte `Pecose`** | Versionnement du code, de la roadmap et des ressources distribuées |
| Hébergement de l'interface | **GitHub Pages** | Hébergement HTTPS statique gratuit ; aucun PC ni serveur personnel à laisser allumé |
| Authentification | **Firebase Authentication** (adresse e-mail et mot de passe) | Une identité pour retrouver les sauvegardes ; adresse `@icloud.com` possible |
| Sauvegarde synchronisée | **Cloud Firestore, formule Firebase Spark** | Sauvegardes automatiques de l'agenda, des tâches et des métadonnées légères dans les quotas gratuits |
| Données locales | **IndexedDB + persistance Firestore côté navigateur** | Accès hors ligne ; bibliothèque de fichiers personnels sur l'iPhone |
| Notifications planifiées | **Web Push iOS + Cloudflare Workers/Cron**, à valider en prototype | Rappels possibles sans PC allumé, dans les quotas gratuits des services |
| Multimédia | **Fichiers Suno personnels et images locales** | Lecture et personnalisation sans dépendance à Deezer |

**Firebase Hosting n'est pas nécessaire** puisque GitHub Pages sert l'application. **Spark est le nom de la formule gratuite**, tandis que **Firestore est la base de données**. Le code GitHub peut être public, mais les données personnelles ne doivent jamais s'y trouver.

### Hors périmètre pour la V1

- Synchronisation obligatoire avec Apple Calendar ou iCloud.
- Distribution App Store, TestFlight, compilation `.ipa`, hébergement personnel ou abonnement payant.
- Intégration Deezer (abandonnée pour la V1 au profit des morceaux Suno personnels).
- Sauvegarde automatique des gros fichiers audio et image sur Firebase : **Cloud Storage for Firebase ne fait pas partie de l'approche gratuite Spark retenue**.
- Réveil natif garanti à heure exacte lorsque le téléphone est hors ligne : **une PWA ne peut pas promettre ce comportement**.

## 2. Principes d'expérience utilisateur

### Écrans principaux

1. **Accueil** : résumé du jour, prochain rendez-vous, tâches prioritaires, lecteur compact et décor saisonnier.
2. **Agenda** : vues mois / semaine / jour, création et modification d'événements, horaires, répétitions, descriptions et rappels.
3. **Tâches** : listes, cases à cocher, priorités, dates limites, récurrences, catégories et historique de tâches terminées.
4. **Musique** : bibliothèque locale, recherche, favoris, playlists, lecture/pause/suivant/précédent, pochettes et import de fichiers.
5. **Décoration** : fonds par saison, galerie, import Photos/Fichiers, thèmes et couleurs ; petit éditeur simple (recadrage, texte) dans une étape ultérieure.
6. **Paramètres** : compte, état de synchronisation, notifications, données locales, export/restauration, version de l'application.

### Contenus dynamiques

- L'utilisatrice peut **ajouter, modifier, supprimer et classer** ses images et musiques sans modifier le code.
- Les ressources **incluses dans l'application** et celles **importées par l'utilisatrice** sont identifiées séparément.
- À l'installation initiale : **2 ou 3 musiques et 2 ou 3 images** de démonstration/ambiance, sous réserve des droits de diffusion des œuvres.
- Les futures mises à jour peuvent ajouter de nouveaux contenus par défaut, **sans effacer** les contenus personnels.
- Les fonds peuvent évoluer automatiquement selon la saison, avec choix manuel prioritaire si l'utilisatrice le souhaite.

## 3. Stockage, synchronisation et sécurité

### Répartition des données

| Donnée | Local sur iPhone | Firestore (auto) | Export / restauration |
|---|---|---|---|
| Événements, horaires, répétitions | Oui | **Oui** | Oui |
| Tâches, listes, statuts | Oui | **Oui** | Oui |
| Préférences, thèmes choisis, favoris et playlists (métadonnées) | Oui | Oui, en volume léger | Oui |
| Images et décorations importées | **Oui** | Non | **Oui, archive utilisateur** |
| Fichiers audio Suno importés | **Oui** | Non | **Oui, archive utilisateur** |
| Fichiers de départ intégrés au site | Cache de l'application | Non | Retéléchargement depuis GitHub Pages |

### Comportement attendu

- **Enregistrement local immédiat** à chaque modification, sans bouton « Sauvegarder » nécessaire.
- **Synchronisation automatique Firestore** quand le réseau est disponible ; mise en attente des écritures hors ligne selon les capacités et réglages de persistance du navigateur.
- Afficher les états : **Enregistré localement / Synchronisation en cours / Synchronisé / Erreur**.
- Associer toutes les données du cloud à l'**UID Firebase** de l'utilisatrice ; règles Firestore limitant lecture et écriture à `request.auth.uid` correspondant.
- Aucune clé privée, aucun mot de passe et aucun identifiant de service Cloudflare dans GitHub ou le code accessible au navigateur. Les paramètres publics Firebase ne sont pas en soi des secrets, **les règles de sécurité sont indispensables**.
- Prévoir **export JSON de l'agenda et des tâches**, sauvegardes datées et restauration contrôlée : synchroniser une erreur ou une suppression n'est pas équivalent à disposer d'une sauvegarde historique.
- Prévoir un **export/import d'archive multimédia** vers l'application Fichiers / iCloud Drive, distinct de la synchronisation automatique de Firestore.
- Tester réellement les pertes de cache et la réinstallation : **IndexedDB sur iOS n'est pas un stockage d'archives garanti**.

### Modèle de données initial (à ajuster)

```text
users/{uid}/events/{eventId}
users/{uid}/tasks/{taskId}
users/{uid}/lists/{listId}
users/{uid}/playlists/{playlistId}
users/{uid}/preferences/profile
users/{uid}/reminders/{reminderId}
```

Les playlists cloud contiennent **des références/métadonnées** ; les fichiers musicaux personnels restent dans le stockage local. Après changement de téléphone, les listes peuvent être retrouvées, mais les fichiers personnels doivent être réimportés à partir de l'archive ; afficher clairement les morceaux manquants.

## 4. Rappels, alarmes et notifications

### Ce qui est prévu

- Pendant que la PWA est ouverte : rappels visibles dans l'interface, sons/indicateurs si l'utilisatrice l'autorise.
- PWA installée sur l'écran d'accueil : demander l'autorisation de **Web Push** par une action explicite de l'utilisatrice.
- Pour les événements à venir : un programme **Cloudflare Worker avec Cron Trigger** vérifie périodiquement les rappels à envoyer et sollicite l'envoi push, même si le PC de développement est éteint.
- Gérer le fuseau horaire (`Europe/Paris` par défaut à confirmer), les changements d'heure, les rappels récurrents et l'absence de doublons.
- Traiter les expirations/renouvellements d'abonnement push et les refus d'autorisation.
- Dans les paramètres : bouton **Envoyer un rappel de test** et statut de disponibilité des notifications.

### Limites à annoncer sans ambiguïté

- Un push dépend du réseau, des réglages de notifications, des modes Concentration et des services du système ; **ni son heure exacte ni une sonnerie longue ne sont garanties**.
- **Un réveil hors ligne, application fermée, à heure exacte ne peut pas être garanti en PWA.** Pour cette fonction, il faudrait changer de stratégie technique (application iOS native avec API d'alarmes appropriée) ou recourir à l'application Horloge de l'iPhone.
- Si les essais iPhone échouent ou si l'utilisatrice exige des réveils critiques, **la décision technologique doit être réévaluée avant de poursuivre**.

### Prototype obligatoire (jalon bloquant)

- Installer la PWA sur le **véritable iPhone** de l'utilisatrice.
- Tester un rappel à **+2 minutes**, application fermée, écran verrouillé.
- Tester hors ligne et en mode Concentration ; consigner ce qui arrive réellement.
- Tester une répétition, un changement d'heure simulé et le non-envoi de doublons.

## 5. Bibliothèque musicale et images

### Musique Suno

- Accepter les **fichiers personnels autorisés à être utilisés** (MP3/M4A et autres formats effectivement compatibles avec Safari iOS).
- Import depuis **Fichiers**, conservation locale des fichiers (IndexedDB), titres, artistes, pochettes et tags.
- Playlists créables et modifiables, favoris, recherche, tri, réorganisation.
- Lecteur intégré : lecture, pause, piste suivante/précédente, barre de progression, volume selon possibilités du navigateur, répétition et lecture aléatoire.
- **Tester très tôt** la lecture quand l'écran se verrouille, les commandes de l'écran verrouillé et l'enchaînement des titres : iOS/PWA peut limiter certaines interactions en arrière-plan.
- Fournir quelques morceaux de base dans les ressources de l'application, après vérification des droits Suno applicables à leur publication publique sur GitHub Pages.

### Images / décoration

- Galerie avec catégories et tags ; import depuis Photos/Fichiers.
- Fonds d'écran internes à l'application (pas modification automatique du fond du système iOS).
- Thèmes de printemps, été, automne et hiver ; sélection automatique selon la date avec possibilité de forcer un thème.
- Personnalisation des couleurs, de la disposition et des éléments décoratifs dans une mesure raisonnable pour l'ergonomie.
- Petit éditeur de création dans l'application (**phase ultérieure**) : composition simple, recadrage, redimensionnement, texte ; **pas de génération IA d'images distante incluse dans la promesse de gratuité**.
- Compression/redimensionnement des images à l'import pour ne pas saturer le stockage local.

## 6. Mises à jour depuis GitHub

- Sources hébergées sous `Pecose/organiseur-personnel` (nom provisoire).
- **GitHub Pages** sert les fichiers statiques HTTPS et le manifeste PWA.
- **Service worker** avec stratégie de cache versionnée : l'application s'ouvre hors ligne après une première installation complète réussie.
- Quand une nouvelle version est publiée : notification **« Nouvelle version disponible »**, bouton « Mettre à jour » et remplacement contrôlé des caches de l'application.
- Les mises à jour du code et des ressources par défaut **ne doivent pas toucher aux stores IndexedDB utilisateur ni supprimer ses données personnelles**.
- Les nouveaux fichiers fournis par défaut sont catalogués avec identifiant et version ; éviter les doublons.
- Réserver les mises à jour multimédias volumineuses à un téléchargement explicite si nécessaire (réseau et stockage).
- Pour changer de téléphone : Safari → URL GitHub Pages → partage → **Ajouter à l'écran d'accueil / Ouvrir comme app** → connexion Firebase → restauration des données cloud → réimport éventuel de la bibliothèque multimédia.

## 7. Roadmap de livraison par étapes

> Les cases ne sont pas cochées : **aucune implémentation n'est encore réalisée**.

### Phase 0 — Validation des risques iPhone (priorité absolue)

- [x] Créer un **nouveau dépôt sous `Pecose`**, séparé d'Umbral (nom de travail : `organiseur-personnel`).
- [ ] Initialiser PWA minimale (`index.html`, manifest, service worker, icônes, HTTPS via GitHub Pages).
- [ ] L'installer sur l'iPhone à partir de Safari (sans `.ipa`, sans Mac distant).
- [ ] Tester l'ouverture **hors ligne**, puis avec le PC Windows éteint.
- [ ] Importer une musique Suno personnelle ; tester lecture, écran verrouillé, piste suivante et reprise.
- [ ] Tester un push avec l'application fermée ; noter les restrictions et décider du niveau de fiabilité acceptable.
- [ ] Vérifier l'espace de stockage disponible et les comportements après redémarrage du téléphone.

**Critère de sortie :** installation et fonctionnement offline validés ; limitations audio et notifications connues, documentées et acceptées.

### Phase 1 — Fondations & interface

- [ ] Initialiser TypeScript et un framework d'interface léger (choix de framework non figé).
- [ ] Créer navigation, écrans Accueil / Agenda / Tâches / Musique / Décoration / Paramètres.
- [ ] Définir charte graphique, thèmes et composants adaptés au format iPhone.
- [ ] Configurer manifeste PWA, icônes, service worker et cache offline robuste.
- [ ] Créer un système de gestion des erreurs et d'indicateur réseau/synchronisation.
- [ ] Mettre en place une configuration de développement et une configuration de production distinctes.

**Critère de sortie :** application navigable, installable et esthétique, sans backend requis pour l'ouvrir.

### Phase 2 — Agenda, tâches et stockage local

- [ ] CRUD des rendez-vous, heures, descriptions, catégories et répétitions.
- [ ] Vues jour / semaine / mois et résumé des rendez-vous du jour.
- [ ] CRUD des tâches et listes, statuts, priorités, dates, récurrences et filtres.
- [ ] Modèle de données avec identifiants stables, dates UTC + fuseau explicite.
- [ ] Enregistrement local immédiat ; fonctionnement offline des fonctions principales.
- [ ] Tests de cohérence après fermeture/réouverture, redémarrage et absence de réseau.

**Critère de sortie :** agenda et tâches utilisables sur le téléphone sans connexion.

### Phase 3 — Compte, sauvegardes et reprise sur nouvel appareil

- [x] Créer un projet **Firebase Spark**, sans activer de facturation (configuration initiale confirmée par le propriétaire).
- [ ] Firebase Authentication : connexion e-mail/mot de passe activée ; **restent** à implémenter dans l'application le parcours de connexion et la récupération d'accès.
- [ ] Firestore : base créée ; **restent** à configurer les règles de sécurité par utilisateur et à tester les refus d'accès croisés.
- [ ] Activer la persistance locale compatible Safari et la synchronisation automatique.
- [ ] Gérer conflits/erreurs de synchronisation et états visibles.
- [ ] Tester modification offline puis retour du réseau.
- [ ] Tester déconnexion, effacement local et récupération des données cloud après reconnexion.
- [ ] Ajouter export JSON daté + import/validation + restauration des données.
- [ ] Vérifier les quotas gratuits et protéger le projet contre une activation involontaire de services payants.

**Critère de sortie :** agenda/tâches restaurés sur un iPhone réinstallé, sans manipulation de sauvegarde à chaque modification.

### Phase 4 — Rappels et notifications

- [ ] Concevoir les champs de rappel (date/heure, avance, répétition, zone horaire, statut).
- [ ] Demander l'autorisation Web Push depuis la PWA installée.
- [ ] Stocker et maintenir l'abonnement push de l'appareil de façon sécurisée.
- [ ] Déployer un Cloudflare Worker + Cron Trigger sur l'offre gratuite et la gestion des secrets.
- [ ] Interroger les rappels dus via un accès **serveur sécurisé** à la base ; ne jamais exposer de clé de service dans le navigateur.
- [ ] Envoyer des notifications avec prévention des doublons et journaux d'échec minimaux.
- [ ] Proposer un test de notification, choix du délai de rappel et désactivation.
- [ ] Vérifier la livraison sur iPhone réel, écran verrouillé, mode Concentration, réseau absent, changement d'heure.

**Critère de sortie :** rappels push satisfaisants en pratique ; limites et cas non garantis affichés clairement.

### Phase 5 — Bibliothèque musicale locale

- [ ] Définir stores IndexedDB pour fichiers audio, pochettes, métadonnées, playlists et favoris.
- [ ] Import audio depuis l'iPhone et validations de taille/format ; messages d'erreur utiles.
- [ ] Lecteur complet et barre de progression, playlists, favoris, recherche et tri.
- [ ] Ajouter 2–3 morceaux de base autorisés à être redistribués.
- [ ] Distinguer morceaux de base et fichiers importés par l'utilisatrice.
- [ ] Gérer les pistes manquantes après réinstallation / restauration partielle.
- [ ] Tests iOS de lecture en arrière-plan et de gestion de verrouillage.

**Critère de sortie :** bibliothèque personnalisable utilisable hors ligne dans les limites iOS validées en phase 0.

### Phase 6 — Images et décoration saisonnière

- [ ] Bibliothèque d'images locales, import Photos/Fichiers, classement et suppression.
- [ ] Ajouter 2–3 fonds de base ; fonds printemps/été/automne/hiver.
- [ ] Choix manuel du thème et changement automatique selon les saisons.
- [ ] Paramètres de couleur, widgets/ornements et disposition dans l'application.
- [ ] Compression, aperçu, recadrage simple à l'import.
- [ ] Petit éditeur de composition et ajout de texte (amélioration progressive).

**Critère de sortie :** personnalisation libre sans intervention du développeur.

### Phase 7 — Export multimédia, mises à jour et robustesse

- [ ] Exporter/importer une archive de bibliothèque (images, fichiers audio, métadonnées) via Fichiers/iCloud Drive.
- [ ] Documenter la procédure de changement d'iPhone en deux volets : **sync cloud des données** et **archive des médias**.
- [ ] Vérifier l'import de bibliothèques volumineuses en tenant compte des limites mémoire/stockage d'iOS.
- [ ] Versionner les données locales et écrire les migrations IndexedDB.
- [ ] Détecter les nouvelles versions publiées sur GitHub Pages et proposer le rafraîchissement.
- [ ] Vérifier que les mises à jour conservent toutes les données et ajoutent les médias par défaut sans doublon.
- [ ] Tester offline/online, faible stockage, erreurs Firebase, déconnexion et réinstallation.

**Critère de sortie :** application sûre à mettre à jour et données récupérables sur un nouveau téléphone.

### Phase 8 — Livraison et entretien

- [ ] Finaliser README, guide d'installation iPhone, politique de sauvegarde et limites des notifications.
- [ ] Vérifier les droits de redistribution des musiques Suno et images intégrées à un dépôt public.
- [ ] Vérifier qu'aucune donnée privée ou aucun secret ne figure dans le dépôt et dans GitHub Pages.
- [ ] Publier une première version stable ; noter les retours de l'utilisatrice.
- [ ] Suivre les quotas et les modifications des conditions gratuites GitHub/Firebase/Cloudflare.
- [ ] Prévoir une procédure simple de retour à la version antérieure de l'interface sans perdre les données.

**Critère de sortie :** application installée, documentée, accessible et maintenable à 0 € tant que les quotas gratuits sont respectés.

## 8. Matrice de tests de recette

| Scénario | Résultat attendu |
|---|---|
| Installation depuis Safari | Icône sur l'écran d'accueil, ouverture comme application |
| PC éteint | Application et services cloud continuent de fonctionner |
| Mode avion après premier chargement | Agenda, tâches, médias déjà chargés et décor disponibles |
| Création d'une tâche sans réseau | Enregistrée localement puis synchronisée à la reconnexion |
| Nouveau téléphone, même compte | Agenda, tâches, préférences et playlists-métadonnées récupérés |
| Nouvelle installation sans archive multimédia | Médias de base présents ; imports personnels explicitement signalés comme manquants |
| Export/import de bibliothèque | Fichiers personnels retrouvés dans l'application |
| Notification à une heure donnée | Reçue si les services/conditions le permettent ; retard/absence correctement documentés |
| Musique et écran verrouillé | Comportement testé sur le vrai iPhone, limites consignées |
| Mise à jour GitHub Pages | Code/fonds par défaut mis à jour sans effacer les imports et données |
| Mauvais compte Firebase | Impossible d'accéder aux données de l'utilisatrice |
| Règles Firestore | Lecture/écriture non autorisées rejetées |

## 9. Coûts et contraintes non négociables

| Service | Cible | Condition |
|---|---:|---|
| GitHub (dépôt + Pages) | 0 € | Dépôt public pour le site Pages gratuit selon l'offre retenue ; contenu distribué public |
| Firebase Authentication + Firestore (Spark) | 0 € | Dans les quotas gratuits ; ne pas activer Blaze ni des produits payants |
| Cloudflare Workers/Cron | 0 € | Dans les quotas et capacités gratuites du service |
| Stockage local iPhone | 0 € | Capacité disponible et politiques de purge iOS ; archive exportable indispensable |
| Apple Developer Program | 0 € | **Non utilisé** : PWA et non application native |
| Serveur personnel, Mac, abonnement | 0 € | **Non utilisés** |

**Important :** le « 0 € » est une **contrainte de conception**, pas une garantie contractuelle à perpétuité. Si une plateforme modifie ses tarifs ou retire une fonction gratuite, on cherchera une alternative gratuite avant toute dépense.

## 10. Ordre réel de priorité

1. **Tester sur l'iPhone** l'installation PWA, la musique écran verrouillé et une notification fermée.
2. **Sécuriser l'essentiel** : agenda, tâches, offline et synchronisation/restauration Firestore.
3. **Personnaliser** : galerie, thèmes saisonniers et bibliothèque Suno locale.
4. **Fiabiliser** : export multimédia, sauvegarde indépendante, mises à jour et scénarios de changement de téléphone.

> **Décisions restant à préciser avec l'utilisatrice :** nom final de l'application, palette graphique précise, comportements souhaités des rappels et acceptation ou non des limites de lecture audio en arrière-plan. Ces décisions ne bloquent pas la rédaction de la roadmap.