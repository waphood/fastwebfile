/**
 * FastWebFile — Telegram WebApp & Mobile UX Initializer
 * - Anti-Zoom Protection (Pinch, Double-Tap, iOS input zoom, Ctrl+Wheel)
 * - Mobile Fullscreen (Telegram WebApp Bot API 8.0+)
 * - PC Windowed Mode (keeps desktop in neat adaptive window)
 * - Disable accidental vertical pull-to-close swipes on mobile
 */

(function () {
  'use strict';

  // 1. ── Anti-Zoom Protection ──────────────────────────────────────────────
  // Prevent iOS / Safari gesture zoom (pinch-to-zoom)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      e.preventDefault();
    }, { passive: false });
  });

  // Prevent multi-touch pinch
  document.addEventListener('touchstart', function (e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  // Prevent double-tap zoom (while keeping taps on interactive elements working)
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

  // Prevent Ctrl + MouseWheel zoom on PC/Trackpads
  document.addEventListener('wheel', function (e) {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });

  // Prevent Ctrl +/- zoom keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  });

  // 2. ── Telegram WebApp Setup ─────────────────────────────────────────────
  function setupTelegramWebApp() {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;

    try {
      tg.ready();
    } catch (e) {}

    // Expand to full available height
    try {
      tg.expand();
    } catch (e) {}

    // Check platform: Mobile vs PC
    var platform = (tg.platform || '').toLowerCase();
    var isMobile = platform === 'ios' ||
                   platform === 'android' ||
                   /iphone|ipad|ipod|android/i.test(navigator.userAgent);

    if (isMobile) {
      // Mobile: Request true Fullscreen (Bot API 8.0+)
      if (typeof tg.requestFullscreen === 'function') {
        try {
          tg.requestFullscreen();
        } catch (e) {
          console.warn('[WebApp] requestFullscreen failed:', e);
        }
      }
      // Disable pull-to-close swipes so scrolling inside the app never dismisses it
      if (typeof tg.disableVerticalSwipes === 'function') {
        try {
          tg.disableVerticalSwipes();
        } catch (e) {}
      }
      document.documentElement.classList.add('tg-mobile-fullscreen');
    } else {
      // Desktop / PC: Keep windowed mode
      document.documentElement.classList.add('tg-desktop-window');
    }

    // Adapt colors to theme if available
    try {
      if (typeof tg.setHeaderColor === 'function') {
        tg.setHeaderColor('#0c0c0f');
      }
      if (typeof tg.setBackgroundColor === 'function') {
        tg.setBackgroundColor('#0c0c0f');
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTelegramWebApp);
  } else {
    setupTelegramWebApp();
  }
})();
