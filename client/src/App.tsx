import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import HomePage from "./pages/HomePage";
import Upload from "./pages/Upload";
import Chat from "./pages/Chat";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import PersonaEdit from "./pages/PersonaEdit";
import Analytics from "./pages/Analytics";
import Diary from "./pages/Diary";
import Roleplay from "./pages/Roleplay";

function Router() {
  const [location] = useLocation();
  return (
    <div key={location} className="route-transition">
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/login" component={Login} />
        <Route path="/settings" component={Settings} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/diary" component={Diary} />
        <Route path="/roleplay" component={Roleplay} />
        <Route path="/persona/:id/edit" component={PersonaEdit} />
        <Route path="/upload/:id" component={Upload} />
        <Route path="/chat/:id" component={Chat} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function useClickRipple() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.("button");
      if (!target || (target as HTMLButtonElement).disabled) return;
      if (!String(target.className).includes("bg-primary")) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.2;
      const span = document.createElement("span");
      span.className = "ripple-ink";
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      const cs = getComputedStyle(target);
      if (cs.position === "static") target.style.position = "relative";
      if (cs.overflow !== "hidden") target.style.overflow = "hidden";
      target.appendChild(span);
      setTimeout(() => span.remove(), 600);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
}

function App() {
  useClickRipple();
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <LocaleProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
