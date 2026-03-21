#!/bin/bash
# DQN Trading Bot - Server Manager

CMD="node server/index.js"
PID_FILE="/tmp/dqn-server.pid"
LOG_FILE="/tmp/dqn-server.log"

start() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "Server already running (PID: $(cat $PID_FILE)"
        return 1
    fi
    
    echo "Starting DQN Trading Bot..."
    nohup $CMD > $LOG_FILE 2>&1 &
    echo $! > $PID_FILE
    echo "Started (PID: $(cat $PID_FILE)"
    echo "Log: $LOG_FILE"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat $PID_FILE)
        if kill -0 $PID 2>/dev/null; then
            kill $PID
            rm $PID_FILE
            echo "Stopped (PID: $PID)"
        else
            echo "Not running"
            rm -f $PID_FILE
        fi
    else
        echo "Not running"
    fi
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat $PID_FILE) 2>/dev/null; then
        echo "Running (PID: $(cat $PID_FILE)"
        tail -5 $LOG_FILE 2>/dev/null
    else
        echo "Not running"
    fi
}

restart() {
    stop
    sleep 1
    start
}

case "$1" in
    start) start ;;
    stop) stop ;;
    restart) restart ;;
    status) status ;;
    log) tail -20 $LOG_FILE ;;
    *) echo "Usage: $0 {start|stop|restart|status|log}" ;;
esac
