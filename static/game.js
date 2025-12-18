const $ = (id) => document.getElementById(id);

const el = {
    title: $("title"),
    lang: $("lang"),
    screenHome: $("screenHome"),
    screenGame: $("screenGame"),
    roomInfo: $("roomInfo"),
    roomCode: $("roomCode"),
    btnCopyRoom: $("btnCopyRoom"),
    btnShareRoom: $("btnShareRoom"),
    roomInfoMobile: $("roomInfoMobile"),
    roomCodeMobile: $("roomCodeMobile"),
    btnCopyRoomMobile: $("btnCopyRoomMobile"),
    lblName: $("lblName"),
    lblRoomId: $("lblRoomId"),
    btnCreate: $("btnCreate"),
    btnJoin: $("btnJoin"),
    name: $("name"),
    roomId: $("roomId"),
    connHint: $("connHint"),
    status: $("status"),
    substatus: $("substatus"),
    lblOrientation: $("lblOrientation"),
    btnOrient: $("btnOrient"),
    btnClear: $("btnClear"),
    btnReady: $("btnReady"),
    myBoard: $("myBoard"),
    enemyBoard: $("enemyBoard"),
    fleetLabel: $("fleetLabel"),
    fleet: $("fleet"),
    enemyHint: $("enemyHint"),
    toast: $("toast"),
    lblMyBoard: $("lblMyBoard"),
    lblEnemyBoard: $("lblEnemyBoard"),
    // modal elements
    overlay: $("overlay"),
    modalTitle: $("modalTitle"),
    modalMsg: $("modalMsg"),
    btnModalOk: $("btnModalOk"),
};

let ws = null;
let ROOM_ID = null;
let PID = null;

let UI = {};
let FLEET = [];
let BOARD_SIZE = 10;

let phase = "disconnected"; // disconnected|lobby|battle|game_over
let orientation = "H"; // H|V
let selectedShipIdx = 0; // which ship length from fleet is being placed
let myPlacement = makeEmptyBoard(); // 0/1
let myPlaced = false;
let myReady = false;

let myState = makeEmptyBoard();    // for display: 0 water, 1 ship, 2 hit, -1 miss
let enemyState = makeEmptyBoard(); // only hits/misses on enemy
let yourTurn = false;

function setConnecting(isConnecting, hintText) {
    const hint = hintText || (UI.connecting || "Connecting…");
    if (el.btnCreate) el.btnCreate.disabled = !!isConnecting;
    if (el.btnJoin) el.btnJoin.disabled = !!isConnecting;
    if (el.connHint) el.connHint.textContent = isConnecting ? hint : (UI.open_two || "Open this page in two browser tabs/windows to play.");
}

function shareUrlFor(roomId) {
    try {
        const base = `${location.origin}${location.pathname}`;
        const url = new URL(base);
        url.searchParams.set("room", roomId);
        return url.toString();
    } catch {
        return `${location.origin}${location.pathname}?room=${roomId}`;
    }
}

function updateRoomShareUI() {
    const hasRoom = !!ROOM_ID;
    const code = hasRoom ? ROOM_ID : "—";
    if (el.roomCode) el.roomCode.textContent = code;
    if (el.roomCodeMobile) el.roomCodeMobile.textContent = code;

    // Show Share button only if available
    const canShare = typeof navigator !== "undefined" && !!navigator.share;
    if (el.btnShareRoom) {
        if (canShare) el.btnShareRoom.classList.remove("hidden");
        else el.btnShareRoom.classList.add("hidden");
    }

    // Wire copy buttons once
    const doCopy = async () => {
        if (!ROOM_ID) return;
        const link = shareUrlFor(ROOM_ID);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(link);
            } else {
                const ta = document.createElement("textarea");
                ta.value = link;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            toast(UI.copied || "Link copied");
        } catch {
            toast(UI.copy_failed || "Copy failed");
        }
    };

    const doShare = async () => {
        if (!ROOM_ID) return;
        const link = shareUrlFor(ROOM_ID);
        try {
            if (navigator.share) {
                await navigator.share({
                    title: UI.title || "Battleship",
                    text: UI.share_text || "Join my Battleship room",
                    url: link,
                });
            } else {
                await doCopy();
            }
        } catch (_) {
            // user canceled; ignore
        }
    };

    if (el.btnCopyRoom && !el.btnCopyRoom._wired) {
        el.btnCopyRoom._wired = true;
        el.btnCopyRoom.addEventListener("click", doCopy);
    }
    if (el.btnCopyRoomMobile && !el.btnCopyRoomMobile._wired) {
        el.btnCopyRoomMobile._wired = true;
        el.btnCopyRoomMobile.addEventListener("click", doCopy);
    }
    if (el.btnShareRoom && !el.btnShareRoom._wired) {
        el.btnShareRoom._wired = true;
        el.btnShareRoom.addEventListener("click", doShare);
    }

    // Update hint on home if we have code (optional)
}

function showScreen(which) {
    if (!el.screenHome || !el.screenGame) return;
    if (which === "game") {
        el.screenHome.classList.add("hidden");
        el.screenGame.classList.remove("hidden");
    } else {
        el.screenGame.classList.add("hidden");
        el.screenHome.classList.remove("hidden");
    }
}

function resetToHome() {
    try { if (ws) ws.close(); } catch (_) {}
    ws = null;
    ROOM_ID = null;
    PID = null;
    UI = UI || {};
    FLEET = [];
    BOARD_SIZE = 10;
    phase = "disconnected";
    orientation = "H";
    selectedShipIdx = 0;
    myPlacement = makeEmptyBoard();
    myPlaced = false;
    myReady = false;
    myState = makeEmptyBoard();
    enemyState = makeEmptyBoard();
    yourTurn = false;
    // clear UI containers
    if (el.fleet) el.fleet.innerHTML = "";
    if (el.myBoard) el.myBoard.innerHTML = "";
    if (el.enemyBoard) el.enemyBoard.innerHTML = "";
    setTexts();
    setStatus(UI.title || "Battleship", "");
    // remove room param from URL
    try { history.replaceState(null, "", location.pathname); } catch (_) {}
    showScreen("home");
    setConnecting(false);
    updateRoomShareUI();
}

function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    setTimeout(() => el.toast.classList.add("hidden"), 1600);
}

function showModal(title, message) {
    if (title) el.modalTitle.textContent = title;
    if (message) el.modalMsg.textContent = message;
    el.overlay.classList.remove("hidden");
}

function hideModal() {
    el.overlay.classList.add("hidden");
}

function makeEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0));
}

function isIn(x, y) {
    return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

function neighbors8(x, y) {
    const out = [];
    for (let dy of [-1, 0, 1]) {
        for (let dx of [-1, 0, 1]) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (isIn(nx, ny)) out.push([nx, ny]);
        }
    }
    return out;
}

// Validate placement rules: straight ships, fleet exact, no diagonal/side touch across ships
function validateFleet(board, fleet) {
    // components with 4-neighborhood
    const vis = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    const comps = [];

    function dfs(sx, sy) {
        const stack = [[sx, sy]];
        vis[sy][sx] = true;
        const comp = [];
        while (stack.length) {
            const [x, y] = stack.pop();
            comp.push([x, y]);
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx, ny = y + dy;
                if (isIn(nx, ny) && !vis[ny][nx] && board[ny][nx] === 1) {
                    vis[ny][nx] = true;
                    stack.push([nx, ny]);
                }
            }
        }
        return comp;
    }

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 1 && !vis[y][x]) {
                comps.push(dfs(x, y));
            }
        }
    }

    // line & contiguous + gather lengths
    const lengths = [];
    const compId = new Map();
    comps.forEach((comp, i) => comp.forEach(([x,y]) => compId.set(`${x},${y}`, i)));

    for (const comp of comps) {
        const xs = new Set(comp.map(([x,_]) => x));
        const ys = new Set(comp.map(([_,y]) => y));
        if (xs.size !== 1 && ys.size !== 1) return false;

        if (xs.size === 1) {
            const x = [...xs][0];
            const ysSorted = comp.map(([_,y]) => y).sort((a,b)=>a-b);
            for (let i=1;i<ysSorted.length;i++) if (ysSorted[i] !== ysSorted[0]+i) return false;
            // ensure all have same x already
            if (!comp.every(([cx,_]) => cx === x)) return false;
        } else {
            const y = [...ys][0];
            const xsSorted = comp.map(([x,_]) => x).sort((a,b)=>a-b);
            for (let i=1;i<xsSorted.length;i++) if (xsSorted[i] !== xsSorted[0]+i) return false;
            if (!comp.every(([_,cy]) => cy === y)) return false;
        }
        lengths.push(comp.length);
    }

    // no touching across different comps (8-neighborhood)
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] !== 1) continue;
            for (const [nx, ny] of neighbors8(x, y)) {
                if (board[ny][nx] === 1 && compId.get(`${nx},${ny}`) !== compId.get(`${x},${y}`)) {
                    return false;
                }
            }
        }
    }

    const want = [...fleet].sort((a,b)=>a-b);
    const got = [...lengths].sort((a,b)=>a-b);
    if (want.length !== got.length) return false;
    for (let i=0;i<want.length;i++) if (want[i] !== got[i]) return false;

    return true;
}

// helpers to compute placed ship components and counts by length
function components4(board) {
    const vis = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    const comps = [];
    function dfs(sx, sy) {
        const stack = [[sx, sy]];
        vis[sy][sx] = true;
        const comp = [];
        while (stack.length) {
            const [x, y] = stack.pop();
            comp.push([x, y]);
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx, ny = y + dy;
                if (isIn(nx, ny) && !vis[ny][nx] && board[ny][nx] === 1) {
                    vis[ny][nx] = true;
                    stack.push([nx, ny]);
                }
            }
        }
        return comp;
    }
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 1 && !vis[y][x]) comps.push(dfs(x, y));
        }
    }
    return comps;
}

function fleetAllowedCounts(fleet) {
    const counts = new Map();
    for (const len of fleet) counts.set(len, (counts.get(len) || 0) + 1);
    return counts;
}

function fleetPlacedCounts(board) {
    const comps = components4(board);
    const counts = new Map();
    for (const comp of comps) {
        const l = comp.length;
        counts.set(l, (counts.get(l) || 0) + 1);
    }
    return counts;
}

function renderBoards() {
    el.myBoard.innerHTML = "";
    el.enemyBoard.innerHTML = "";

    // My board shows ships + hits/misses
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const v = myState[y][x];
            const cell = document.createElement("button");
            cell.className = baseCellClass();
            cell.title = `${x},${y}`;

            // colors by state (tailwind classes)
            if (v === 1) cell.classList.add("bg-slate-700");
            else if (v === 2) cell.classList.add("bg-rose-700");
            else if (v === -1) cell.classList.add("bg-slate-800");
            else cell.classList.add("bg-slate-900");

            // placement click in lobby
            cell.onclick = () => {
                if (phase !== "lobby") return;
                if (myReady) return;
                placeAt(x, y);
            };

            el.myBoard.appendChild(cell);
        }
    }

    // Enemy board shows only shot marks. Click to shoot in battle
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const v = enemyState[y][x];
            const cell = document.createElement("button");
            cell.className = baseCellClass();
            cell.title = `${x},${y}`;

            if (v === 2) cell.classList.add("bg-rose-700");
            else if (v === -1) cell.classList.add("bg-slate-800");
            else cell.classList.add("bg-slate-900");

            cell.onclick = () => {
                if (phase !== "battle") return;
                if (!yourTurn) return;
                if (enemyState[y][x] === 2 || enemyState[y][x] === -1) return;
                ws.send(JSON.stringify({ type: "shot", x, y }));
            };

            el.enemyBoard.appendChild(cell);
        }
    }

    // Visual guidance for turns on the enemy board container
    if (phase === "battle") {
        if (yourTurn) {
            el.enemyBoard.classList.remove("pointer-events-none", "opacity-60", "ring-0");
            el.enemyBoard.classList.add("ring", "ring-emerald-600/60", "ring-offset-1", "ring-offset-slate-900");
        } else {
            el.enemyBoard.classList.add("pointer-events-none", "opacity-60");
            el.enemyBoard.classList.remove("ring", "ring-emerald-600/60", "ring-offset-1", "ring-offset-slate-900");
        }
    } else {
        el.enemyBoard.classList.remove("pointer-events-none", "opacity-60", "ring", "ring-emerald-600/60", "ring-offset-1", "ring-offset-slate-900");
    }
}

function baseCellClass() {
    return "w-8 h-8 md:w-9 md:h-9 rounded-md border border-slate-800 hover:border-slate-600 transition";
}

function renderFleet() {
    el.fleet.innerHTML = "";
    FLEET.forEach((len, idx) => {
        const b = document.createElement("button");
        b.className = "px-2 py-1 rounded border text-sm " + (idx === selectedShipIdx ? "bg-slate-700 border-slate-500" : "bg-slate-900 border-slate-800 hover:bg-slate-800");
        b.textContent = `${len}`;
        b.onclick = () => { selectedShipIdx = idx; renderFleet(); };
        el.fleet.appendChild(b);
    });
}

function clearPlacement() {
    myPlacement = makeEmptyBoard();
    myPlaced = false;
    myReady = false;
    myState = makeEmptyBoard();
    enemyState = makeEmptyBoard();
    selectedShipIdx = 0;
    renderFleet();
    renderBoards();
}

function placeAt(x, y) {
    // toggle ship cell placement using selected length; place as full ship, not per cell
    const len = FLEET[selectedShipIdx];
    if (!len) return;

    // try place ship with current orientation starting at (x,y)
    const coords = [];
    for (let i = 0; i < len; i++) {
        const nx = orientation === "H" ? x + i : x;
        const ny = orientation === "H" ? y : y + i;
        if (!isIn(nx, ny)) return;
        coords.push([nx, ny]);
    }

    // must be empty and no neighbor touches
    for (const [cx, cy] of coords) {
        if (myPlacement[cy][cx] === 1) return;
        for (const [nx, ny] of neighbors8(cx, cy)) {
            if (myPlacement[ny][nx] === 1) return;
        }
    }

    // enforce fleet counts: do not exceed number of ships of this length
    const allowed = fleetAllowedCounts(FLEET);
    const placed = fleetPlacedCounts(myPlacement);
    const already = placed.get(len) || 0;
    const canHave = allowed.get(len) || 0;
    if (already >= canHave) {
        toast(UI.invalid_placement || "Invalid placement");
        return;
    }

    // place
    for (const [cx, cy] of coords) {
        myPlacement[cy][cx] = 1;
        myState[cy][cx] = 1;
    }

    // advance ship selection (next)
    // move to next ship that is not yet fully placed
    const placedAfter = fleetPlacedCounts(myPlacement);
    let nextIdx = selectedShipIdx;
    for (let i = 0; i < FLEET.length; i++) {
        const idx = (selectedShipIdx + 1 + i) % FLEET.length;
        const l = FLEET[idx];
        if ((placedAfter.get(l) || 0) < (allowed.get(l) || 0)) { nextIdx = idx; break; }
    }
    selectedShipIdx = nextIdx;
    renderFleet();
    renderBoards();

    // if complete (matches fleet), auto-validate and send placement
    if (validateFleet(myPlacement, FLEET)) {
        myPlaced = true;
        sendPlacement();
    } else {
        myPlaced = false;
    }
}

function sendPlacement() {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "place", board: myPlacement }));
    toast("OK");
}

function setTexts() {
    el.title.textContent = UI.title || "Battleship";
    document.title = UI.title || "Battleship";
    el.lblName.textContent = UI.enter_name || "Enter name";
    el.lblRoomId.textContent = UI.room_id || "Room ID";
    el.btnCreate.textContent = UI.create_room || "Create room";
    el.btnJoin.textContent = UI.join_room || "Join room";
    el.lblOrientation.textContent = UI.orientation || "Orientation";
    el.btnOrient.textContent = (orientation === "H" ? (UI.horizontal || "Horizontal") : (UI.vertical || "Vertical"));
    el.btnClear.textContent = UI.clear || "Clear";
    // Button should reflect the action: if already ready -> allow unready; else -> ready up
    el.btnReady.textContent = myReady ? (UI.not_ready || "Unready") : (UI.ready || "Ready");
    el.fleetLabel.textContent = (UI.fleet_label || "Fleet");
    // Fallback English labels for boards (not provided in UI)
    el.lblMyBoard.textContent = UI.my_board || "My board";
    el.lblEnemyBoard.textContent = UI.enemy_board || "Enemy board";
    el.enemyHint.textContent = phase === "battle" ? "" : (UI.lobby_ready_hint || "");
    // Optional room label text updates
    if (el.roomInfo) {
        const labelSpan = el.roomInfo.querySelector("span");
        if (labelSpan) labelSpan.textContent = UI.room || "Room";
    }
    if (el.roomInfoMobile) {
        const labelSpan = el.roomInfoMobile.querySelector("span");
        if (labelSpan) labelSpan.textContent = UI.room || "Room";
    }
    if (el.btnCopyRoom) el.btnCopyRoom.textContent = UI.copy || "Copy";
    if (el.btnShareRoom) el.btnShareRoom.textContent = UI.share || "Share";
    if (el.btnCopyRoomMobile) el.btnCopyRoomMobile.textContent = UI.copy || "Copy";
}

function setStatus(main, sub="") {
    el.status.textContent = main || "—";
    el.substatus.textContent = sub || "";

    // colorize banner by turn
    if (phase === "battle") {
        if (yourTurn) {
            el.status.className = "text-sm text-emerald-400";
        } else {
            el.status.className = "text-sm text-amber-400";
        }
    } else {
        el.status.className = "text-sm text-slate-300";
    }
}

function connect(roomId, lang, name) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/${roomId}`);
    setConnecting(true);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: "join", lang, name }));
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === "error") {
            toast(msg.message || "Error");
            // if we aren't initialized yet, allow retry from Home
            if (!ROOM_ID || phase === "disconnected") setConnecting(false);
            return;
        }
        if (msg.type === "info") {
            toast(msg.message || "Info");
            return;
        }

        if (msg.type === "init") {
            ROOM_ID = msg.room_id;
            PID = msg.pid;
            UI = msg.ui || {};
            FLEET = msg.fleet || [];
            BOARD_SIZE = msg.board_size || 10;

            // init boards
            clearPlacement();
            setTexts();

            // show link in roomId
            el.roomId.value = ROOM_ID;
            // Update URL to contain shareable room parameter
            try { history.replaceState(null, "", `${location.pathname}?room=${ROOM_ID}`); } catch (_) {}
            updateRoomShareUI();
            phase = "lobby";
            setStatus(UI.place_ships || "Place ships", UI.waiting_opponent || "");
            renderFleet();
            renderBoards();
            showScreen("game");
            setConnecting(false);
            return;
        }

        if (msg.type === "init_ui") {
            if (msg.ui) UI = msg.ui;
            // Do not overwrite current fleet/boards on-the-fly; only refresh texts
            setTexts();
            renderFleet();
            return;
        }

        if (msg.type === "state") {
            phase = msg.phase || phase;

            // update statuses
            const players = msg.players || [];
            const me = players.find(p => p.name === el.name.value.trim());
            myReady = !!(me && me.ready);
            // refresh UI texts that depend on readiness (button label, hints)
            setTexts();

            if (phase === "lobby") {
                setStatus(UI.place_ships || "Place ships", UI.lobby_ready_hint || "");
                // show both players' readiness
                const readySummary = players.map(p => `${p.name || "?"}: ${p.ready ? (UI.ready||"Ready") : (UI.not_ready||"Not ready")}`).join(" · ");
                el.substatus.textContent = readySummary;
            } else if (phase === "battle") {
                // turn message arrives via "turn" or shot_result, but keep something
                const turnName = msg.turn_name ? `(${msg.turn_name})` : "";
                setStatus(yourTurn ? (UI.your_turn || "Your turn") : (UI.opponent_turn || "Opponent's turn"), turnName);
                renderBoards();
            } else if (phase === "game_over") {
                setStatus(UI.game_over || "Game over", msg.winner ? `Winner: ${msg.winner}` : "");
            }

            return;
        }

        if (msg.type === "phase") {
            if (msg.phase === "battle") {
                phase = "battle";
                setStatus(UI.opponent_turn || "Opponent's turn", "");
                el.enemyHint.textContent = "";
                renderBoards();
            }
            return;
        }

        if (msg.type === "turn") {
            yourTurn = !!msg.your_turn;
            setStatus(msg.text || (yourTurn ? (UI.your_turn||"Your turn") : (UI.opponent_turn||"Opponent's turn")), "");
            renderBoards();
            return;
        }

        if (msg.type === "shot_result") {
            // result applies to enemy state (if you fired) or to your state (if opponent fired)
            const { x, y, result, sunk_cells, fired_by_you } = msg;

            if (fired_by_you) {
                if (result === "hit" || result === "sunk") enemyState[y][x] = 2;
                if (result === "miss") enemyState[y][x] = -1;
            } else {
                if (result === "hit" || result === "sunk") myState[y][x] = 2;
                if (result === "miss") myState[y][x] = -1;
            }

            // if sunk, mark around sunk ship on enemy as miss to avoid meaningless shots
            if (fired_by_you && result === "sunk" && Array.isArray(sunk_cells)) {
                // sunk_cells is array of [x,y] pairs
                const seen = new Set(sunk_cells.map(([cx, cy]) => `${cx},${cy}`));
                for (const [sx, sy] of sunk_cells) {
                    for (const [nx, ny] of neighbors8(sx, sy)) {
                        const key = `${nx},${ny}`;
                        if (seen.has(key)) continue; // part of the sunk ship
                        if (enemyState[ny][nx] === 0) {
                            enemyState[ny][nx] = -1; // mark as miss
                        }
                    }
                }
            }

            yourTurn = !!msg.your_turn;
            phase = msg.phase || phase;

            if (msg.result_text) toast(msg.result_text);

            if (phase === "battle") {
                setStatus(yourTurn ? (UI.your_turn || "Your turn") : (UI.opponent_turn || "Opponent's turn"), "");
            }

            if (phase === "game_over") {
                setStatus(UI.game_over || "Game over", msg.winner ? `Winner: ${msg.winner}` : "");
            }

            renderBoards();
            return;
        }

        if (msg.type === "game_over") {
            const message = msg.message || (UI.game_over || "Game over");
            toast(message);
            phase = "game_over";
            setStatus(UI.game_over || "Game over", message || "");
            showModal(UI.game_over || "Game over", message);
            return;
        }
    };

    ws.onclose = () => {
        ws = null;
        phase = "disconnected";
        setStatus("Disconnected", "");
        // Return to home if connection drops
        showScreen("home");
        setConnecting(false);
    };
}

// UI actions
async function loadLanguage(lang) {
    try {
        const r = await fetch(`/ui/${lang}`);
        const data = await r.json();
        if (data && data.ui) {
            UI = data.ui;
            setTexts();
        }
    } catch {}
}

el.lang.onchange = async () => {
    const lang = el.lang.value;
    await loadLanguage(lang);
    if (ws) {
        ws.send(JSON.stringify({ type: "set_lang", lang }));
    }
};
el.btnOrient.onclick = () => {
    orientation = (orientation === "H") ? "V" : "H";
    el.btnOrient.textContent = (orientation === "H" ? (UI.horizontal || "Horizontal") : (UI.vertical || "Vertical"));
};

el.btnClear.onclick = () => {
    clearPlacement();
    setTexts();
    setStatus(UI.place_ships || "Place ships", UI.lobby_ready_hint || "");
};

el.btnReady.onclick = () => {
    if (!ws) return;
    // Toggle readiness: if currently ready -> unready; else -> validate and ready up
    if (myReady) {
        ws.send(JSON.stringify({ type: "set_ready", ready: false }));
        myReady = false;
        setTexts();
        toast(UI.not_ready || "Not ready");
        return;
    }
    if (!validateFleet(myPlacement, FLEET)) {
        toast(UI.invalid_placement || "Invalid placement");
        return;
    }
    ws.send(JSON.stringify({ type: "place", board: myPlacement }));
    ws.send(JSON.stringify({ type: "set_ready", ready: true }));
    myReady = true;
    setTexts();
    toast(UI.ready || "Ready");
};

el.btnCreate.onclick = async () => {
    const lang = el.lang.value;
    const name = el.name.value.trim();
    if (!name) return toast(UI.enter_name || "Enter name");
    setConnecting(true, UI.creating_room || "Creating room…");
    const r = await fetch(`/create/${lang}`, { method: "POST" });
    const data = await r.json();
    el.roomId.value = data.room_id;
    connect(data.room_id, lang, name);
};

el.btnJoin.onclick = async () => {
    const lang = el.lang.value;
    const name = el.name.value.trim();
    const roomId = el.roomId.value.trim();
    if (!name) return toast(UI.enter_name || "Enter name");
    if (!roomId) return toast("Room ID required");
    setConnecting(true);
    connect(roomId, lang, name);
};


// preload room from URL
(function initFromUrl() {
    const url = new URL(location.href);
    const room = url.searchParams.get("room");
    if (room) el.roomId.value = room;
    el.connHint.textContent = "Open this page in two browser tabs/windows to play.";
    // initialize UI texts for current language selection
    loadLanguage(el.lang.value);
})();

// modal ok
if (el.btnModalOk) {
    el.btnModalOk.onclick = () => { hideModal(); resetToHome(); };
}
