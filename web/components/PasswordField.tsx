"use client";

// The sign-in password box: a show/hide button and a Caps Lock warning.
// Without JavaScript it's still a normal password box, so signing in works either way.

import { useState } from "react";

export function PasswordField() {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // Browsers report Caps Lock on key events, so check it as you type.
  function checkCapsLock(event: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <div className="signin-field-wrap">
      <div className="signin-field">
        <svg className="signin-field-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        </svg>
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          autoFocus
          required
          onKeyDown={checkCapsLock}
          onKeyUp={checkCapsLock}
        />
        <button type="button" className="signin-reveal" onClick={() => setVisible(!visible)} aria-pressed={visible}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <span className="signin-caps" aria-live="polite">{capsLock ? "Caps Lock is on" : ""}</span>
    </div>
  );
}
