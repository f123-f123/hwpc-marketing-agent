import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SessionApp } from "./session/SessionApp";
import "./styles/tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionApp />
  </StrictMode>,
);
