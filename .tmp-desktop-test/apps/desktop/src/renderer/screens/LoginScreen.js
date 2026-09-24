import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { apiClient } from "../services/api-client";
export function LoginScreen({ onLoginSuccess, onError }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    async function handleSubmit(e) {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Login failed";
            console.error('[LoginScreen] login error', message, err);
            setError(message);
            onError?.(message);
            setIsLoading(false);
        }
    }
    return (_jsx("div", { className: "login-screen", children: _jsxs("div", { className: "login-container", children: [_jsxs("div", { className: "login-header", children: [_jsx("h1", { children: "GiTO Live Sports" }), _jsx("p", { className: "subtitle", children: "Operator Console" })] }), _jsxs("form", { onSubmit: handleSubmit, className: "login-form", children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "email", children: "Operator Email" }), _jsx("input", { id: "email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "operator@gito.local", disabled: isLoading, autoFocus: true, required: true })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "password", children: "Password" }), _jsx("input", { id: "password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", disabled: isLoading, required: true })] }), error && _jsx("div", { className: "error-message", children: error }), _jsx("button", { type: "submit", disabled: isLoading || !email.trim() || !password, className: "login-button", children: isLoading ? "Signing in..." : "Sign In" })] }), _jsx("div", { className: "login-info", children: _jsx("p", { className: "info-text", children: "Enter your operator email to access the broadcast console." }) })] }) }));
}
