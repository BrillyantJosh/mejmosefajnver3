import { useParams, useNavigate } from "react-router-dom";
import BeingChat from "./BeingChat";

/**
 * Wrapper that reads pubkey from URL params and passes to BeingChat.
 * This allows the same chat component to work with any being.
 */
export default function BeingConversation() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const navigate = useNavigate();

  if (!pubkey) {
    navigate('/being');
    return null;
  }

  return <BeingChat beingPubkey={pubkey} />;
}
