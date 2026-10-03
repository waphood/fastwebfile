/**
 * FastWebFile — Telegram WebApp & Mobile UX Initializer
 * - Anti-Zoom Protection (Pinch, Double-Tap, iOS input zoom, Ctrl+Wheel)
 * - Mobile Fullscreen (Telegram WebApp Bot API 8.0+)
 * - PC Windowed Mode (keeps desktop in neat adaptive window)
 * - Disable accidental vertical pull-to-close swipes on mobile
 * - iOS Native Draggable Segmented Control (Drag & Slide gesture with haptics)
 */

(function () {
  'use strict';

  // 1. ── Anti-Zoom Protection ──────────────────────────────────────────────
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      e.preventDefault();
    }, { passive: false });
  });

  document.addEventListener('touchstart', function (e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 320) {
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'SELECT' && tag !== 'LABEL') {
        e.preventDefault();
      }
    }
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('wheel', function (e) {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  });

  // 2. ── Telegram WebApp Setup ─────────────────────────────────────────────
  function setupTelegramWebApp() {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;

    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}

    var platform = (tg.platform || '').toLowerCase();
    var isMobile = platform === 'ios' ||
                   platform === 'android' ||
                   /iphone|ipad|ipod|android/i.test(navigator.userAgent);

    if (isMobile) {
      if (typeof tg.requestFullscreen === 'function') {
        try { tg.requestFullscreen(); } catch (e) {}
      }
      if (typeof tg.disableVerticalSwipes === 'function') {
        try { tg.disableVerticalSwipes(); } catch (e) {}
      }
      document.documentElement.classList.add('tg-mobile-fullscreen');
    } else {
      document.documentElement.classList.add('tg-desktop-window');
    }

    try {
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#0c0c0f');
      if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#0c0c0f');
    } catch (e) {}
  }

  // 3. ── iOS Draggable Segmented Control (Drag & Slide Physics) ─────────────
  function initIosSegmentedControl(container, onChange) {
    if (!container || container._iosSegmentedReady) {
      if (container && container._updateThumb) container._updateThumb();
      return;
    }
    container._iosSegmentedReady = true;

    var thumb = container.querySelector('.ios-segmented-thumb');
    if (!thumb) {
      thumb = document.createElement('div');
      thumb.className = 'ios-segmented-thumb';
      container.insertBefore(thumb, container.firstChild);
    }

    var buttons = Array.from(container.querySelectorAll('.expiry-tab, .ios-segment-btn'));
    if (!buttons.length) return;

    var activeIndex = buttons.findIndex(function (b) { return b.classList.contains('active'); });
    if (activeIndex === -1) activeIndex = 0;

    function updateThumb(index, animate) {
      if (index === undefined) index = activeIndex;
      if (index < 0 || index >= buttons.length) return;
      var btn = buttons[index];
      var cRect = container.getBoundingClientRect();
      var bRect = btn.getBoundingClientRect();
      if (bRect.width === 0) return;

      var left = bRect.left - cRect.left;
      var width = bRect.width;

      if (animate === false) {
        thumb.style.transition = 'none';
      } else {
        thumb.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), width 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)';
      }

      thumb.style.transform = 'translateX(' + left + 'px)';
      thumb.style.width = width + 'px';

      buttons.forEach(function (b, i) {
        if (i === index) b.classList.add('active');
        else b.classList.remove('active');
      });
    }

    container._updateThumb = function () {
      var curIdx = buttons.findIndex(function (b) { return b.classList.contains('active'); });
      if (curIdx !== -1) activeIndex = curIdx;
      updateThumb(activeIndex, false);
    };

    // Initial positioning
    requestAnimationFrame(function () { updateThumb(activeIndex, false); });
    setTimeout(function () { updateThumb(activeIndex, false); }, 50);
    window.addEventListener('resize', function () { updateThumb(activeIndex, false); });

    // Click handler for buttons
    buttons.forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        activeIndex = idx;
        updateThumb(activeIndex, true);
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
          try { window.Telegram.WebApp.HapticFeedback.selectionChanged(); } catch (_) {}
        }
      });
    });

    // Pointer Drag & Slide gesture
    var isDragging = false;
    var startX = 0;
    var initialLeft = 0;
    var currentIdx = activeIndex;

    function getIndexFromClientX(clientX) {
      for (var i = 0; i < buttons.length; i++) {
        var r = buttons[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return i;
      }
      if (clientX < buttons[0].getBoundingClientRect().left) return 0;
      return buttons.length - 1;
    }

    container.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;

      isDragging = true;
      container.classList.add('is-dragging');
      thumb.style.transition = 'none';

      startX = e.clientX;
      var cRect = container.getBoundingClientRect();
      var curBtn = buttons[activeIndex];
      initialLeft = curBtn.getBoundingClientRect().left - cRect.left;
      currentIdx = activeIndex;

      var targetBtn = e.target.closest('.expiry-tab, .ios-segment-btn');
      if (targetBtn) {
        var clickedIdx = buttons.indexOf(targetBtn);
        if (clickedIdx !== -1 && clickedIdx !== activeIndex) {
          currentIdx = clickedIdx;
          if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
            try { window.Telegram.WebApp.HapticFeedback.selectionChanged(); } catch (_) {}
          }
        }
      }

      try { container.setPointerCapture(e.pointerId); } catch (_) {}
    });

    container.addEventListener('pointermove', function (e) {
      if (!isDragging) return;
      var cRect = container.getBoundingClientRect();
      var deltaX = e.clientX - startX;
      var minLeft = 3;
      var maxLeft = container.clientWidth - (thumb.offsetWidth || 40) - 3;
      var newLeft = Math.max(minLeft - 4, Math.min(initialLeft + deltaX, maxLeft + 4));

      thumb.style.transform = 'translateX(' + newLeft + 'px)';

      var hoveredIdx = getIndexFromClientX(e.clientX);
      if (hoveredIdx !== currentIdx) {
        currentIdx = hoveredIdx;
        buttons.forEach(function (b, i) {
          if (i === currentIdx) b.classList.add('active');
          else b.classList.remove('active');
        });
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
          try { window.Telegram.WebApp.HapticFeedback.selectionChanged(); } catch (_) {}
        }
      }
    });

    function onEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      container.classList.remove('is-dragging');

      var finalIdx = getIndexFromClientX(e.clientX);
      activeIndex = finalIdx;
      updateThumb(activeIndex, true);

      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        try { window.Telegram.WebApp.HapticFeedback.impactOccurred('light'); } catch (_) {}
      }

      var selBtn = buttons[activeIndex];
      var val = selBtn.getAttribute('data-value') || selBtn.getAttribute('data-val');

      // Trigger click on the button so any page-level listeners fire normally
      selBtn.click();

      if (typeof onChange === 'function') {
        onChange(val, selBtn, activeIndex);
      }

      container.dispatchEvent(new CustomEvent('segmentchange', {
        detail: { value: val, index: activeIndex }
      }));
    }

    container.addEventListener('pointerup', onEnd);
    container.addEventListener('pointercancel', onEnd);
  }

  window.initIosSegmentedControl = initIosSegmentedControl;

  function initAllSegmented() {
    document.querySelectorAll('.expiry-tabs, .ios-segmented').forEach(function (c) {
      initIosSegmentedControl(c);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setupTelegramWebApp();
      initAllSegmented();
    });
  } else {
    setupTelegramWebApp();
    initAllSegmented();
  }
})();
