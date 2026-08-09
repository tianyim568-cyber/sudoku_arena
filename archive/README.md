# archive/

Fichiers **hors application** conservés « au cas où » (pas utilisés par le serveur ni le client, mais potentiellement réutilisables). Rangés ici pour ne pas encombrer la racine.

| Fichier | Rôle | Note |
|---|---|---|
| `create_test_excel.py` | Script Python qui génère `test_participants.xlsx` (10 faux participants) pour tester l'import de participants. | ⚠️ Le chemin de sauvegarde est en dur (`C:\Users\Administrator\Desktop\project_3\…`, machine d'un autre dev) → à adapter avant de le relancer. |
| `test_participants.xlsx` | Jeu de données de test (10 participants) pour l'import Excel. | Généré par le script ci-dessus. |

> Pour régénérer le fichier de test : adapter le chemin en bas de `create_test_excel.py`, installer `openpyxl` (`pip install openpyxl`), puis `python create_test_excel.py`.
