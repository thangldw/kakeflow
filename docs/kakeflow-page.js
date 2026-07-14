(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#primary-nav');

  function closeMenu() {
    if (!menuButton || !navigation) return;
    menuButton.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  }

  menuButton?.addEventListener('click', () => {
    const willOpen = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(willOpen));
    navigation?.classList.toggle('is-open', willOpen);
  });
  navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  window.addEventListener('resize', () => {
    if (window.innerWidth > 820) closeMenu();
  });

  const screenData = {
    overview: {
      src: 'assets/screenshots/kakeflow-overview.png',
      width: 1280,
      height: 1073,
      title: '家計の概要',
      alt: 'KakeFlow 家計の概要画面',
      description: '発生ベースの支出、キャッシュフロー、カード負債の状態を一画面で把握します。',
    },
    transactions: {
      src: 'assets/screenshots/kakeflow-transactions.png',
      width: 1280,
      height: 720,
      title: '取引台帳',
      alt: 'KakeFlow の検索可能な取引台帳画面',
      description: 'カテゴリ、ラベル、タグ、計算対象を編集し、元のファイルやレシートへ戻れます。',
    },
    import: {
      src: 'assets/screenshots/kakeflow-import-inbox.png',
      width: 1280,
      height: 770,
      title: 'Import Inbox',
      alt: 'KakeFlow の Import Inbox 画面',
      description: '取り込み候補、重複、振替、カード支払い、低 confidence の抽出結果を確認します。',
    },
  };

  const tabs = [...document.querySelectorAll('[role="tab"][data-screen]')];
  const screenImage = document.querySelector('#screen-image');
  const screenCaption = document.querySelector('#screen-caption');
  const screenPanel = document.querySelector('#screen-panel');

  function selectScreen(tab, moveFocus = false) {
    const screen = screenData[tab.dataset.screen];
    if (!screen || !screenImage || !screenCaption || !screenPanel) return;
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
    });
    screenImage.src = screen.src;
    screenImage.width = screen.width;
    screenImage.height = screen.height;
    screenImage.alt = screen.alt;
    screenCaption.innerHTML = '';
    const title = document.createElement('b');
    const description = document.createElement('span');
    title.textContent = screen.title;
    description.textContent = screen.description;
    screenCaption.append(title, description);
    screenPanel.setAttribute('aria-labelledby', tab.id);
    if (moveFocus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectScreen(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      selectScreen(tabs[nextIndex], true);
    });
  });

  const board = document.querySelector('#workflow-board');
  const canvas = document.querySelector('#workflow-lines');
  if (!board || !(canvas instanceof HTMLCanvasElement)) return;

  const edges = [
    ['bank', 'inbox'], ['card', 'inbox'], ['wallet', 'inbox'], ['receipt', 'inbox'], ['securities', 'inbox'],
    ['inbox', 'extract'],
    ['extract', 'dedupe'], ['extract', 'receipt-match'], ['extract', 'card-match'],
    ['dedupe', 'ledger'], ['receipt-match', 'ledger'], ['card-match', 'ledger'],
    ['ledger', 'household'], ['ledger', 'cashflow'], ['ledger', 'balance'], ['ledger', 'portfolio'],
  ];
  const nodes = new Map();
  board.querySelectorAll('[data-node]').forEach((element) => nodes.set(element.dataset.node, element));
  const ledger = board.querySelector('.ledger-hub');
  if (ledger) nodes.set('ledger', ledger);

  function pointOnSide(rect, boardRect, towardRight) {
    return {
      x: (towardRight ? rect.right : rect.left) - boardRect.left,
      y: rect.top + rect.height / 2 - boardRect.top,
    };
  }

  function drawArrow(context, from, to, color, alpha) {
    const direction = to.x >= from.x ? 1 : -1;
    const distance = Math.max(34, Math.abs(to.x - from.x) * .42);
    const control1 = { x: from.x + distance * direction, y: from.y };
    const control2 = { x: to.x - distance * direction, y: to.y };

    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, to.x, to.y);
    context.stroke();

    const angle = Math.atan2(to.y - control2.y, to.x - control2.x);
    context.setLineDash([]);
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(to.x - 8 * Math.cos(angle - Math.PI / 6), to.y - 8 * Math.sin(angle - Math.PI / 6));
    context.lineTo(to.x - 8 * Math.cos(angle + Math.PI / 6), to.y - 8 * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawWorkflow(activeNode = null) {
    const boardRect = board.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(boardRect.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(boardRect.height * pixelRatio));
    canvas.style.width = `${boardRect.width}px`;
    canvas.style.height = `${boardRect.height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, boardRect.width, boardRect.height);

    edges.forEach(([fromId, toId]) => {
      const fromNode = nodes.get(fromId);
      const toNode = nodes.get(toId);
      if (!fromNode || !toNode) return;
      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();
      const isForward = toRect.left + toRect.width / 2 >= fromRect.left + fromRect.width / 2;
      const isRelated = !activeNode || fromId === activeNode || toId === activeNode;
      const color = fromId === 'card-match' || toId === 'card-match' ? '#bb715d' : '#75836e';
      drawArrow(
        context,
        pointOnSide(fromRect, boardRect, isForward),
        pointOnSide(toRect, boardRect, !isForward),
        color,
        isRelated ? .86 : .18,
      );
    });
  }

  function setActiveNode(nodeId = null) {
    const connected = new Set([nodeId]);
    edges.forEach(([from, to]) => {
      if (from === nodeId) connected.add(to);
      if (to === nodeId) connected.add(from);
    });
    nodes.forEach((element, id) => {
      element.classList.toggle('is-related', Boolean(nodeId) && connected.has(id));
      element.classList.toggle('is-muted', Boolean(nodeId) && !connected.has(id));
    });
    drawWorkflow(nodeId);
  }

  nodes.forEach((element) => {
    element.addEventListener('pointerenter', () => setActiveNode(id));
    element.addEventListener('pointerleave', () => setActiveNode());
  });

  const resizeObserver = new ResizeObserver(() => drawWorkflow());
  resizeObserver.observe(board);
  window.addEventListener('load', () => drawWorkflow(), { once: true });
})();
