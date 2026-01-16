#!/bin/bash

# restart-vnc.sh
# Restarts the VNC Server, Fluxbox Window Manager, and noVNC proxy
# Useful if the Codespace has hibernated or display services are unresponsive.

echo "[INFO] Stopping existing VNC services..."
# Kill any lingering processes
sudo pkill -f "Xtigervnc"
sudo pkill -f "fluxbox"
sudo pkill -f "websockify"
sudo pkill -f "novnc_proxy"

# Wait a moment for processes to exit
sleep 2

echo "[INFO] Cleaning up lock files..."
# Clean up VNC lock files for Display :1
sudo rm -rf /tmp/.X1-lock
sudo rm -rf /tmp/.X11-unix/X1
# Clean up any pid files
rm -f ~/.vnc/*.pid
rm -f ~/.vnc/*.log

echo "[INFO] Configuring startup..."
# Ensure VNC config directory exists
mkdir -p ~/.vnc

# Create a basic xstartup file to launch Fluxbox automatically
cat <<EOF > ~/.vnc/xstartup
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
# Start the window manager
exec fluxbox
EOF

chmod +x ~/.vnc/xstartup

echo "[INFO] Starting VNC Server (Display :1)..."
# Start VNC server in a background loop to ensure persistence
nohup bash -c 'while :; do 
    echo "Starting Xtigervnc..."
    tigervncserver :1 -geometry 1440x768 -depth 16 -rfbport 5901 -dpi 96 -localhost -SecurityTypes None
    echo "Xtigervnc exited, restarting in 2s..."
    sleep 2
done' > /tmp/vnc-server.log 2>&1 &

echo "[INFO] Starting noVNC Proxy (Port 6080)..."
# Dynamically find the noVNC installation directory
NOVNC_DIR=$(find /usr/local/novnc -maxdepth 1 -type d -name "noVNC*" | head -n 1)

if [ -z "$NOVNC_DIR" ]; then
    echo "[ERROR] noVNC directory not found in /usr/local/novnc"
    exit 1
fi

# Start noVNC proxy in a background loop
nohup bash -c "while :; do 
    echo \"Starting novnc_proxy...\"
    $NOVNC_DIR/utils/novnc_proxy --listen 6080 --vnc localhost:5901
    echo \"novnc_proxy exited, restarting in 2s...\"
    sleep 2
done" > /tmp/novnc-proxy.log 2>&1 &

echo "---------------------------------------------------"
echo "✅ Services restarted successfully."
echo "   - VNC Server: Display :1 (Port 5901)"
echo "   - Web Access: Port 6080"
echo ""
echo "👉 Check the 'Ports' tab in VS Code and open Port 6080."
echo "   If the screen is blank, ensure URL ends in '/vnc.html'"
echo "---------------------------------------------------"
