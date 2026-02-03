// Modal setup for controls rebinding and how-to-play
import { ControlsManager, controls } from './config.js';

// --- Controls Menu ---

let _controlsMenuSetup = false;
let _controlsModal = null;
let _controlsModalHandlers = null;

export function setupControlsMenu() {
  const modal = document.getElementById('controls-modal');
  const openBtn = document.getElementById('controls-btn');
  const closeBtn = document.getElementById('close-controls-btn');
  const resetBtn = document.getElementById('reset-controls-btn');

  if (!modal || !openBtn) return;

  // Prevent duplicate setup
  if (_controlsMenuSetup) return;
  _controlsMenuSetup = true;

  // State for key rebinding
  _controlsModal = {
    listeningElement: null,
    listeningAction: null,
    listeningIndex: null,
    previouslyFocusedElement: null
  };

  const modalState = _controlsModal;

  // Render the current controls
  const renderControls = () => {
    const rows = modal.querySelectorAll('.control-row');
    rows.forEach(row => {
      const action = row.dataset.action;
      const keysContainer = row.querySelector('.control-keys');
      const keys = controls.get(action);

      keysContainer.innerHTML = '';

      keys.forEach((key, index) => {
        const btn = document.createElement('button');
        btn.className = 'key-btn';
        btn.textContent = ControlsManager.getKeyDisplayName(key);
        btn.dataset.index = index;
        btn.addEventListener('click', () => startListening(btn, action, index));

        // Right-click to remove
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (keys.length > 1) {
            const newKeys = keys.filter((_, i) => i !== index);
            controls.set(action, newKeys);
            renderControls();
          }
        });

        keysContainer.appendChild(btn);
      });

      // Add "+" button to add more keys (max 3)
      if (keys.length < 3) {
        const addBtn = document.createElement('button');
        addBtn.className = 'key-btn add-key';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', () => startListening(addBtn, action, keys.length));
        keysContainer.appendChild(addBtn);
      }
    });
  };

  // Start listening for a key press
  const startListening = (element, action, index) => {
    // Cancel previous listening
    if (modalState.listeningElement) {
      modalState.listeningElement.classList.remove('listening');
    }

    modalState.listeningElement = element;
    modalState.listeningAction = action;
    modalState.listeningIndex = index;
    element.classList.add('listening');
    element.textContent = 'Press key...';
  };

  // Store handler references for proper removal
  _controlsModalHandlers = {};

  _controlsModalHandlers.handleKeyDown = (e) => {
    if (!modalState.listeningElement) return;

    e.preventDefault();
    e.stopPropagation();

    // Cancel on Escape
    if (e.code === 'Escape') {
      modalState.listeningElement.classList.remove('listening');
      modalState.listeningElement = null;
      renderControls();
      return;
    }

    // Set the new key
    const currentKeys = [...controls.get(modalState.listeningAction)];
    if (modalState.listeningIndex < currentKeys.length) {
      currentKeys[modalState.listeningIndex] = e.code;
    } else {
      currentKeys.push(e.code);
    }
    controls.set(modalState.listeningAction, currentKeys);

    modalState.listeningElement.classList.remove('listening');
    modalState.listeningElement = null;
    renderControls();
  };

  _controlsModalHandlers.handleMouseDown = (e) => {
    if (!modalState.listeningElement) return;

    e.preventDefault();
    e.stopPropagation();

    const mouseCode = `Mouse${e.button}`;

    // Set the new key
    const currentKeys = [...controls.get(modalState.listeningAction)];
    if (modalState.listeningIndex < currentKeys.length) {
      currentKeys[modalState.listeningIndex] = mouseCode;
    } else {
      currentKeys.push(mouseCode);
    }
    controls.set(modalState.listeningAction, currentKeys);

    modalState.listeningElement.classList.remove('listening');
    modalState.listeningElement = null;
    renderControls();
  };

  // Focus trap handler for accessibility
  _controlsModalHandlers.handleFocusTrap = (e) => {
    if (e.key !== 'Tab') return;

    const focusableElements = modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  };

  const handlers = _controlsModalHandlers;

  // Close modal
  const closeModal = () => {
    modal.classList.remove('active');
    if (modalState.listeningElement) {
      modalState.listeningElement.classList.remove('listening');
      modalState.listeningElement = null;
    }
    document.removeEventListener('keydown', handlers.handleKeyDown, true);
    document.removeEventListener('mousedown', handlers.handleMouseDown, true);
    document.removeEventListener('keydown', handlers.handleFocusTrap);
    if (modalState.previouslyFocusedElement) {
      modalState.previouslyFocusedElement.focus();
    }
  };

  // Open modal
  openBtn.addEventListener('click', () => {
    if (modal.classList.contains('active')) return;

    modalState.previouslyFocusedElement = document.activeElement;
    modal.classList.add('active');
    renderControls();
    document.addEventListener('keydown', handlers.handleKeyDown, true);
    document.addEventListener('mousedown', handlers.handleMouseDown, true);
    document.addEventListener('keydown', handlers.handleFocusTrap);
    const firstFocusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled])');
    if (firstFocusable) {
      firstFocusable.focus();
    }
  });

  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Reset controls
  resetBtn?.addEventListener('click', () => {
    controls.reset();
    renderControls();
  });
}

export function destroyControlsMenu() {
  _controlsMenuSetup = false;
  _controlsModal = null;
  _controlsModalHandlers = null;
}

// --- How to Play Modal ---

let _howToPlayModalSetup = false;
let _howToPlayModal = null;
let _howToPlayHandlers = null;

export function setupHowToPlayModal() {
  const modal = document.getElementById('how-to-play-modal');
  const openBtn = document.getElementById('how-to-play-btn');
  const closeBtn = document.getElementById('close-how-to-play-btn');

  if (!modal || !openBtn) return;

  // Prevent duplicate setup
  if (_howToPlayModalSetup) return;
  _howToPlayModalSetup = true;

  _howToPlayModal = {
    previouslyFocusedElement: null
  };

  const modalState = _howToPlayModal;

  _howToPlayHandlers = {};

  // Focus trap handler for accessibility
  _howToPlayHandlers.handleFocusTrap = (e) => {
    if (e.key !== 'Tab') return;

    const focusableElements = modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  };

  // Close on Escape key
  _howToPlayHandlers.handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };

  const handlers = _howToPlayHandlers;

  // Close modal function
  const closeModal = () => {
    modal.classList.remove('active');
    document.removeEventListener('keydown', handlers.handleFocusTrap);
    document.removeEventListener('keydown', handlers.handleEscape);
    if (modalState.previouslyFocusedElement) {
      modalState.previouslyFocusedElement.focus();
    }
  };

  // Open modal
  openBtn.addEventListener('click', () => {
    if (modal.classList.contains('active')) return;

    modalState.previouslyFocusedElement = document.activeElement;
    modal.classList.add('active');
    document.addEventListener('keydown', handlers.handleFocusTrap);
    document.addEventListener('keydown', handlers.handleEscape);
    const firstFocusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled])');
    if (firstFocusable) {
      firstFocusable.focus();
    }
  });

  closeBtn?.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

export function destroyHowToPlayModal() {
  _howToPlayModalSetup = false;
  _howToPlayModal = null;
  _howToPlayHandlers = null;
}
