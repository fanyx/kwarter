# Build the KWin runtime bundle from src/.
build:
    node tools/build.js

# Install Kwarter into the user's KWin scripts directory.
install: build
    kpackagetool6 --type=KWin/Script -i .
    just reconfigure

# Upgrade the installed Kwarter package.
upgrade: build
    kpackagetool6 --type=KWin/Script -u .
    just reconfigure

# Ask KWin to reload its configuration.
reconfigure:
    dbus-send --session --type=method_call --dest=org.kde.KWin /KWin org.kde.KWin.reconfigure
