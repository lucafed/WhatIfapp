import { Routes, Route } from "react-router-dom";
import Onboarding from "./routes/Onboarding";
import Home from "./routes/Home";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Onboarding />} />
      <Route path="/home" element={<Home />} />
    </Routes>
  );
}
