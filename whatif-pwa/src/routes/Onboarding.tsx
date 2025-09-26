import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../index.css";

const slides = [
  { id: 1, img: "/logos/whatif_door.svg", text: "Apri la porta al What?f" },
  { id: 2, img: "/logos/whatif_bar.svg", text: "Scegli il tuo bar" }
];

export default function Onboarding() {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();

  const next = () => {
    if (index < slides.length - 1) setIndex((i) => i + 1);
    else navigate("/home");
  };

  return (
    <div className="screen">
      <img src={slides[index].img} alt="logo" className="logo" />
      <p>{slides[index].text}</p>
      <button className="btn" onClick={next}>
        {index < slides.length - 1 ? "Next →" : "Entra"}
      </button>
      <div className="dots">
        {slides.map((s, i) => (
          <span key={s.id} className={i === index ? "dot active" : "dot"} />
        ))}
      </div>
    </div>
  );
}
