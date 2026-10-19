import { createRoot } from "react-dom/client";
import { TimechainGame } from "../../src/app/horizon/components/TimechainGame.tsx";

/* 0 hides the "real chain is at block N" line. A saved snapshot must
   not be presented as the live tip. */
createRoot(document.getElementById("root")).render(<TimechainGame liveTipHeight={0} />);
