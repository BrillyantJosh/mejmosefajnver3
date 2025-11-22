import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ModulesProvider } from "./contexts/ModulesContext";
import { AdminProvider } from "./contexts/AdminContext";
import { AuthProvider } from "./contexts/AuthContext";
import { SystemParametersProvider } from "./contexts/SystemParametersContext";
import { AdminProtectedRoute, ProtectedRoute } from "./components/ProtectedRoute";
import MainLayout from "./components/layout/MainLayout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import SocialLayout from "./pages/social/SocialLayout";
import Feed from "./pages/social/Feed";
import Rooms from "./pages/social/Rooms";
import Comments from "./pages/social/Comments";
import LanaMusicLayout from "./pages/music/LanaMusicLayout";
import Radio from "./pages/music/Radio";
import Songs from "./pages/music/Songs";
import Popular from "./pages/music/Popular";
import LashLayout from "./pages/lash/LashLayout";
import PayLashes from "./pages/lash/PayLashes";
import ReceivedLashes from "./pages/lash/ReceivedLashes";
import RelaysLayout from "./pages/relays/RelaysLayout";
import RelaysList from "./pages/relays/RelaysList";
import MyEvents from "./pages/relays/MyEvents";
import Kinds from "./pages/relays/Kinds";
import MarketplaceLayout from "./pages/marketplace/MarketplaceLayout";
import MarketplaceLocal from "./pages/marketplace/Local";
import MarketplaceGlobal from "./pages/marketplace/Global";
import MarketplaceMyOffers from "./pages/marketplace/MyOffers";
import OfferDetail from "./pages/marketplace/OfferDetail";
import LanaPaysLayout from "./pages/lanapays/LanaPaysLayout";
import LanaPaysLocation from "./pages/lanapays/LanaPaysLocation";
import LanaPaysOnline from "./pages/lanapays/LanaPaysOnline";
import LanaPaysRedirect from "./pages/lanapays/LanaPaysRedirect";
import BusinessUnitDetail from "./pages/lanapays/BusinessUnitDetail";
import LanaTransparencyLayout from "./pages/transparency/LanaTransparencyLayout";
import TransparencyProfiles from "./pages/transparency/Profiles";
import TransparencyWallets from "./pages/transparency/Wallets";
import UnconditionalPaymentLayout from "./pages/unconditional-payment/UnconditionalPaymentLayout";
import UnconditionalPaymentPending from "./pages/unconditional-payment/Pending";
import UnconditionalPaymentCompleted from "./pages/unconditional-payment/Completed";
import UnconditionalPaymentConfirmPayment from "./pages/unconditional-payment/ConfirmPayment";
import UnconditionalPaymentResult from "./pages/unconditional-payment/Result";
import Chat from "./pages/Chat";
import Wallet from "./pages/Wallet";
import RegisterWallet from "./pages/RegisterWallet";
import RegisterWalletResult from "./pages/RegisterWalletResult";
import SendLana from "./pages/SendLana";
import SendLanaRecipient from "./pages/SendLanaRecipient";
import SendLanaPrivateKey from "./pages/SendLanaPrivateKey";
import SendLanaResult from "./pages/SendLanaResult";
import SellLana from "./pages/SellLana";
import BuyLana from "./pages/BuyLana";
import Lana8Wonder from "./pages/Lana8Wonder";
import NotFound from "./pages/NotFound";
import AdminSettings from "./pages/admin/AdminSettings";
import PublicPost from "./pages/PublicPost";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <SystemParametersProvider>
        <AuthProvider>
          <AdminProvider>
            <ModulesProvider>
              <TooltipProvider>
              <Toaster />
              <Sonner />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/post/:eventId" element={<PublicPost />} />
                <Route element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }>
                  <Route path="/" element={<Home />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/social" element={<SocialLayout />}>
                    <Route index element={<Feed />} />
                    <Route path="rooms" element={<Rooms />} />
                    <Route path="notifications" element={<Comments />} />
                  </Route>
                  <Route path="/lash" element={<LashLayout />}>
                    <Route index element={<PayLashes />} />
                    <Route path="pay" element={<PayLashes />} />
                    <Route path="received" element={<ReceivedLashes />} />
                  </Route>
                  <Route path="/relays" element={<RelaysLayout />}>
                    <Route index element={<RelaysList />} />
                    <Route path="my-events" element={<MyEvents />} />
                    <Route path="kinds" element={<Kinds />} />
                  </Route>
                  <Route path="/marketplace" element={<MarketplaceLayout />}>
                    <Route index element={<MarketplaceLocal />} />
                    <Route path="global" element={<MarketplaceGlobal />} />
                    <Route path="my-offers" element={<MarketplaceMyOffers />} />
                  </Route>
                  <Route path="/marketplace/offer/:offerId" element={<OfferDetail />} />
                  <Route path="/lanapays" element={<LanaPaysLayout />}>
                    <Route index element={<LanaPaysLocation />} />
                    <Route path="location" element={<LanaPaysLocation />} />
                    <Route path="online" element={<LanaPaysOnline />} />
                    <Route path="pay" element={<LanaPaysRedirect />} />
                  </Route>
                  <Route path="/lanapays/unit/:unitId" element={<BusinessUnitDetail />} />
                  <Route path="/transparency" element={<LanaTransparencyLayout />}>
                    <Route index element={<TransparencyProfiles />} />
                    <Route path="profiles" element={<TransparencyProfiles />} />
                    <Route path="wallets" element={<TransparencyWallets />} />
                  </Route>
                  <Route path="/unconditional-payment" element={<UnconditionalPaymentLayout />}>
                    <Route index element={<UnconditionalPaymentPending />} />
                    <Route path="completed" element={<UnconditionalPaymentCompleted />} />
                  </Route>
                  <Route path="/unconditional-payment/confirm-payment" element={<UnconditionalPaymentConfirmPayment />} />
                  <Route path="/unconditional-payment/result" element={<UnconditionalPaymentResult />} />
                  {/* Backward compatibility redirects */}
                  <Route path="/donate" element={<Navigate to="/unconditional-payment" replace />} />
                  <Route path="/donate/donated" element={<Navigate to="/unconditional-payment/completed" replace />} />
                  <Route path="/donate/confirm-payment" element={<Navigate to="/unconditional-payment/confirm-payment" replace />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/wallet" element={<Wallet />} />
                  <Route path="/wallet/register" element={<RegisterWallet />} />
                  <Route path="/wallet/register/result" element={<RegisterWalletResult />} />
                  <Route path="/send-lana" element={<SendLana />} />
            <Route path="/send-lana/recipient" element={<SendLanaRecipient />} />
            <Route path="/send-lana/private-key" element={<SendLanaPrivateKey />} />
            <Route path="/send-lana/result" element={<SendLanaResult />} />
                  <Route path="/sell-lana" element={<SellLana />} />
                  <Route path="/buy-lana" element={<BuyLana />} />
                  <Route path="/lana8wonder" element={<Lana8Wonder />} />
                  <Route path="/music" element={<LanaMusicLayout />}>
                    <Route index element={<Radio />} />
                    <Route path="songs" element={<Songs />} />
                    <Route path="popular" element={<Popular />} />
                  </Route>
                  <Route 
                    path="/admin/settings"
                    element={
                      <AdminProtectedRoute>
                        <AdminSettings />
                      </AdminProtectedRoute>
                    } 
                  />
                </Route>
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </TooltipProvider>
          </ModulesProvider>
        </AdminProvider>
      </AuthProvider>
      </SystemParametersProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
