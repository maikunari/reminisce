import { ChromeSlot } from "@/components/ChromeSlot";

/** The session's footer depends on the session in localStorage, so SessionView fills it from the browser. */
export default function SessionFooter() {
  return <ChromeSlot part="footer" />;
}
