build:
    node tools/build.js

install: build
    kpackagetool6 --type=KWin/Script -i ./package || kpackagetool6 --type=KWin/Script -u ./package
    just reconfigure

uninstall:
    kpackagetool6 --type=KWin/Script -r kwarter
    just reconfigure

reconfigure:
    dbus-send --session --type=method_call --dest=org.kde.KWin /KWin org.kde.KWin.reconfigure
