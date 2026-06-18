import { useEffect, useState } from "react";

interface ToastProps {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
  onClose: (id: string) => void;
}

export function Toast({ id, message, type = "info", onClose }: ToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const showTimer = window.setTimeout(() => setExiting(true), 3000);
    const removeTimer = window.setTimeout(() => onClose(id), 3250);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(removeTimer);
    };
  }, [id, onClose]);

  const handleClose = () => {
    // begin exit animation then remove
    setExiting(true);
    window.setTimeout(() => onClose(id), 220);
  };

  const role = type === "error" ? "alert" : "status";
  const ariaLive = type === "error" ? "assertive" : "polite";

  return (
    <div className={`toast ${type} ${exiting ? "exit" : "enter"}`} role={role} aria-live={ariaLive} aria-atomic="true">
      <div className="toast-content">{message}</div>
      <button className="toast-close" aria-label="Dismiss" onClick={handleClose}>
        ×
      </button>
    </div>
  );
}
