# Uložené verze

- `../Verze4.html`: aktuální varianta s postupným kontextovým zpracováním řeči. Dokončené údaje se nezpracovávají znovu; průběžný náhled je oddělen od potvrzených dat pro uložení a tisk.
- `../Verze3.html`: samostatná kopie Verze3 se souvislým diktováním a živým náhledem textu v buňkách.
- `Verze2.html`: záloha funkčního nástroje před změnami Verze3.
- `../index.html`: aktuálně používaná verze aplikace.

Aktuálně `index.html` odpovídá Verzi4. Verze3 byla při této úpravě ponechána beze změn. Verzi4 lze otevřít samostatně na stejné doméně. Kontrola uložené kopie používá `CHECKLIST_HTML=Verze4.html`. Nové testy ověřují stejné vyplnění při každém rozdělení ukázkové promluvy na hranicích slov, ochranu běžných slov v poznámkách, neplatné hodnoty, nalezení existující osoby a oddělení průběžného přepisu od uložených/tiskových dat.

Pro návrat k Verzi3 nahraďte soubor `index.html` obsahem souboru `Verze3.html`. Ostatní soubory ponechte na místě. Verzi3 lze také přímo otevřít v prohlížeči na stejné doméně jako aplikaci. Hlasové ovládání vyžaduje podporovaný prohlížeč a přístup k mikrofonu.

Souvislý režim je zapnutý výchozí. Další údaj začíná názvem políčka, například „jméno Jan Novák začátek sedm příjezd osm“. Rozdělení řeči rozpoznáváním neurčuje konec údaje. V nápovědě je přepínač na původní režim a rozbalovací přepis diktování. Přepis se uchovává pouze v paměti otevřené stránky; nejde o zvukovou nahrávku. Rozpracovaný přepis se může změnit, dokud ho rozpoznávání nepotvrdí.

Ověření: `node tests/voice.test.cjs` (Playwright / Chrome). Pro kontrolu uložené Verze3 nastavte proměnnou prostředí `CHECKLIST_HTML=Verze3.html`. Testy simulují události rozpoznávání řeči; neověřují skutečný mikrofon ani externí službu převodu řeči.
