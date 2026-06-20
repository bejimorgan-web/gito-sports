import { useState } from "react";
import { apiClient } from "../services/api-client";

interface LoginScreenProps {
  onLoginSuccess: (email: string, accessToken: string) => void;
  onError?: (error: string) => void;
}

export function LoginScreen({ onLoginSuccess, onError }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (!email.trim()) {
        setError("Email is required");
        setIsLoading(false);
        return;
      }

      if (!password) {
        setError("Password is required");
        setIsLoading(false);
        return;
      }

      const session = await apiClient.login(email, password);
      onLoginSuccess(email, session.accessToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      onError?.(message);
      setIsLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="login-header">
          <h1>GiTO Live Sports</h1>
          <p className="subtitle">Operator Console</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Operator Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@gito.local"
              disabled={isLoading}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
              required
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            disabled={isLoading || !email.trim() || !password}
            className="login-button"
          >
            {isLoading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="login-info">
          <p className="info-text">
            Enter your operator email to access the broadcast console.
          </p>
        </div>
      </div>
    </div>
  );
}
