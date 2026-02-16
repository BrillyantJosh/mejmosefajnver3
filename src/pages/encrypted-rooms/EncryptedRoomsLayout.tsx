import { Outlet } from "react-router-dom";

export default function EncryptedRoomsLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <Outlet />
    </div>
  );
}
