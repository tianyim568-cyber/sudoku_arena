
## 2026-08-26 — UX rounds : ConfirmDialog + PDF en mode édition + pop-ups stylées

### Contexte

Louise a testé le CRUD des rounds (livré la veille) et a relevé trois problèmes UX :
1. Le bouton "Import PDF" reste visible sur la ligne read-only d'un round créé, ce qui encombre la lecture. Elle veut que les actions de configuration n'apparaissent qu'en mode édition.
2. Le flux attendu : créer un round → il apparaît dans la liste → cliquer "Edit" pour basculer la ligne en formulaire inline → changer nom/durée/prép + importer PDF → Save → retour à la lecture. C'est déjà ce qui existe, sauf que le bouton PDF fuit sur la ligne read-only.
3. Les pop-ups de confirmation utilisent `window.confirm()` natif du navigateur — moche, pas stylé, casse le langage visuel. Louise veut des modales stylées.

### Modèle de traçage des changements

**Pop-up confirmation (3 emplacements)**
⚙️ Bouton Delete (round / stage / participants) → 🖥️ `handleDeleteRound` / `handleRemoveStage` / `handleDeleteParticipants` → `setConfirm({ title, message, action })` → 🎨 `<ConfirmDialog>` (state-driven, une seule instance sert les 3) → `onConfirm` exécute `action()` puis ferme → `window.confirm()` retiré.

**Bouton PDF en mode édition**
⚙️ Ligne read-only d'un round → plus de bouton PDF (retiré) → 🖱️ Clic "Edit" → bascule `editingRoundId === r.id` → formulaire inline → `<RoundPdfImport>` s'affiche DANS le formulaire (si `r.puzzles?.length === 0`) → Save revient à la lecture. Le PDF n'apparaît plus jamais en mode read-only.

**alert() dans RoundPdfImport**
⚙️ Succès import PDF → `onSuccess(summary)` callback → 🖥️ `msg(summary)` dans CompetitionDetailPage (toast stylé existant) → `alert()` retiré.

### Fichiers modifiés

| Fichier | Changement |
|---|---|
| `client/src/components/ConfirmDialog.jsx` | **NOUVEAU** — composant réutilisable (fond noir/50, carte blanche, bouton rouge si `danger`, bleu sinon). Mirrors le pattern du dialog credentials existant (ligne 862). |
| `client/src/components/RoundPdfImport.jsx` | `alert()` → `onSuccess(summary)` callback optionnel. Le parent décide comment afficher le message. |
| `client/src/pages/CompetitionDetailPage.jsx` | 3 `window.confirm()` → 3 `setConfirm({...})` ; import `ConfirmDialog` ; state `confirm` (null ou object) ; PDF bouton déplacé du mode read-only au mode édition inline ; `<RoundPdfImport onSuccess={msg}>` branché. |
| `client/src/i18n/en.js` | 4 clés ajoutées : `deleteRoundTitle`, `removeStageTitle`, `deleteParticipantsTitle`, `deleteBtn`. |
| `client/src/i18n/zh.js` | Mêmes 4 clés en chinois. |

### Décisions de génie logiciel

1. **Composant `ConfirmDialog` réutilisable** — un seul composant sert les 3 cas. La page parent possède le state `confirm` (null ou {title, message, action, ...}). Le dialog est purement présentationnel : il ne se ferme pas lui-même, c'est le parent qui flip l'état dans `onConfirm`/`onCancel`. Évite une race où le dialog disparaît avant l'appel async (l'utilisateur clique deux fois).

2. **`action` comme fonction passée dans le state** — au lieu de 3 dialogs séparés avec 3 handlers, un seul. Quand l'utilisateur clique "Delete round", `setConfirm({ ..., action: async () => { ... } })`. Le `onConfirm` du dialog appelle `action()` puis ferme. Le `try/catch` attrape les erreurs inattendues et les passe à `msg()`.

3. **PDF uniquement en mode édition** — décision produit de Louise. La ligne read-only affiche le nom + badge + Edit/Delete. Pour configurer (ajouter des puzzles), on entre en mode édition, ce qui déplie le formulaire ET le bouton PDF. Le serveur refuse de toute façon d'overwrite un round qui a déjà des puzzles (40030), donc le bouton n'a de sens que quand le round est vide — on garde la garde `(r.puzzles?.length || 0) === 0`.

4. **`RoundPdfImport` ne dépend plus de `alert()`** — nouveau prop optionnel `onSuccess(summary)`. Si non fourni, le composant ne fait rien sur le succès (silencieux). Le parent passe `onSuccess={(s) => msg(s)}`. Pattern plus propre que de mettre `msg` dans le composant enfant (qui n'a pas à connaître le toast system).

5. **Pas de nouvelle fenêtre modale pour le succès PDF** — le toast existant (`msg()` avec setTimeout 5s) suffit. Louise a dit "beaux pop-ups", ce qui vise surtout les confirmations destructives. Un succès transitoire n'a pas besoin d'attendre un clic.

6. **Style cohérent avec le dialog credentials existant** — même backdrop `bg-black bg-opacity-50`, même carte `bg-white rounded-lg shadow-xl max-w-md`, même z-50. Louise avait déjà vu ce pattern pour les credentials du juge ; on réutilise le langage visuel plutôt que d'en inventer un nouveau.

7. **Pas de librairie externe** — React + Tailwind suffisent. Pas de Material UI, pas de Radix. Le composant fait 70 lignes. Pas de dépendance nouvelle à maintenir.

8. **`role="dialog"` + `aria-modal="true"` + `aria-labelledby`** — accessibilité. Le dialog est annoncé correctement aux lecteurs d'écran.

### Vérifications

- Tests client : 367/367 passent (0 régression, 0 nouveau test — le dialog est couvert par les tests existants du CompetitionDetailRoundMeta qui ne testent pas les confirmations destructives, mais ce comportement n'est pas testé non plus avec window.confirm).
- Build : `npx vite build` OK, 0 erreur.
- Lint serveur : `npx oxlint .` → 0 nouveau warning (258 pré-existants).

### ✅ Commit
- "en attente — Louise décide"
