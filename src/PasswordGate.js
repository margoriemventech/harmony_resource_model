import { useState } from "react";

const PASSWORD = process.env.REACT_APP_PASSWORD || "harmony2024";

export default function PasswordGate({ children }) {
  const [input, setInput] = useState("");
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem("auth") === "1"
  );
  const [error, setError] = useState(false);

  if (unlocked) return children;

  function handleSubmit(e) {
    e.preventDefault();
    if (input === PASSWORD) {
      sessionStorage.setItem("auth", "1");
      setUnlocked(true);
    } else {
      setError(true);
      setInput("");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Calibri, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        padding: "40px 48px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        minWidth: 320,
      }}>
        <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 20, fontWeight: 600 }}>
          Harmony Resource Model
        </h2>
        <p style={{ color: "rgba(255,255,255,0.4)", margin: 0, fontSize: 14 }}>
          Enter password to continue
        </p>
        <input
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          placeholder="Password"
          autoFocus
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 8,
            border: error
              ? "1px solid #ef4444"
              : "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            color: "#e2e8f0",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {error && (
          <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>
            Incorrect password
          </p>
        )}
        <button type="submit" style={{
          width: "100%",
          padding: "10px 0",
          borderRadius: 8,
          border: "none",
          background: "#3b82f6",
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
        }}>
          Enter
        </button>
      </form>
    </div>
  );
}
