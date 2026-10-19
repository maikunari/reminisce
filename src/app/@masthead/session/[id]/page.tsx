import { ChromeSlot } from "@/components/ChromeSlot";

/** The session's masthead depends on the session in localStorage, so SessionView fills it from the browser. */
export default function SessionMasthead() {
  return <ChromeSlot part="masthead" />;
}
