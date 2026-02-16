import { Outlet } from "react-router-dom";

export default function EncryptedRoomsLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-4 sm:pb-20 px-1 sm:px-0">
      <Outlet />
    </div>
  );
}
