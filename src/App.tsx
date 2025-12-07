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
import SocialHome from "./pages/social/Home";
import RoomFeed from "./pages/social/RoomFeed";
import UserProfile from "./pages/social/UserProfile";
import Rooms from "./pages/social/Rooms";
import TinyRooms from "./pages/social/TinyRooms";
import Comments from "./pages/social/Comments";
import LanaMusicLayout from "./pages/music/LanaMusicLayout";
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
import OwnLayout from "./pages/own/OwnLayout";
import Own from "./pages/own/Own";
import OwnSearch from "./pages/own/Search";
import OwnMyCases from "./pages/own/MyCases";
import OwnTranscript from "./pages/own/Transcript";
import StartOwnProcess from "./pages/own/StartOwnProcess";
import RockLayout from "./pages/rock/RockLayout";
import RockGrant from "./pages/rock/Grant";
import RockGrantNew from "./pages/rock/GrantNew";
import RockReceived from "./pages/rock/Received";
import UnregisteredWallets from "./pages/unregistered-wallets/UnregisteredWallets";
import MillionIdeasLayout from "./pages/100millionideas/MillionIdeasLayout";
import Projects from "./pages/100millionideas/Projects";
import ProjectDetail from "./pages/100millionideas/ProjectDetail";
import DonateToProject from "./pages/100millionideas/DonateToProject";
import DonatePrivateKey from "./pages/100millionideas/DonatePrivateKey";
import DonateResult from "./pages/100millionideas/DonateResult";
import MyDonations from "./pages/100millionideas/MyDonations";
import OfflineLanaLayout from "./pages/offlinelana/OfflineLanaLayout";
import GenerateWallet from "./pages/offlinelana/GenerateWallet";
import OfflineWallets from "./pages/offlinelana/OfflineWallets";
import LanaEventsLayout from "./pages/events/LanaEventsLayout";
import OnlineEvents from "./pages/events/OnlineEvents";
import LiveEvents from "./pages/events/LiveEvents";
import AddEvent from "./pages/events/AddEvent";
import EventDetail from "./pages/events/EventDetail";
import MyEventsPage from "./pages/events/MyEvents";
import EditEvent from "./pages/events/EditEvent";
import EventRegistrations from "./pages/events/EventRegistrations";
import EventDonate from "./pages/events/EventDonate";
import EventDonatePrivateKey from "./pages/events/EventDonatePrivateKey";
import EventDonateResult from "./pages/events/EventDonateResult";
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
import PublicEvent from "./pages/PublicEvent";

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
                <Route path="/event/:dTag" element={<PublicEvent />} />
                <Route element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }>
                  <Route path="/" element={<Home />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/social" element={<SocialLayout />}>
                    <Route index element={<Navigate to="/social/home" replace />} />
                    <Route path="feed" element={<Feed />} />
                    <Route path="home" element={<SocialHome />} />
                    <Route path="feed/:roomSlug" element={<RoomFeed />} />
                    <Route path="user/:pubkey" element={<UserProfile />} />
                    <Route path="rooms" element={<Rooms />} />
                    <Route path="tiny-rooms" element={<TinyRooms />} />
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
                  <Route path="/own" element={<OwnLayout />}>
                    <Route index element={<Own />} />
                    <Route path="search" element={<OwnSearch />} />
                    <Route path="my-cases" element={<OwnMyCases />} />
                    <Route path="transcript/:caseId" element={<OwnTranscript />} />
                    <Route path="start/:postId" element={<StartOwnProcess />} />
                  </Route>
          <Route path="/rock" element={<RockLayout />}>
            <Route index element={<RockGrant />} />
            <Route path="grant-new" element={<RockGrantNew />} />
            <Route path="received" element={<RockReceived />} />
          </Route>
          <Route path="/unregistered-wallets" element={<UnregisteredWallets />} />
        <Route path="/100millionideas" element={<MillionIdeasLayout />}>
          <Route index element={<Navigate to="/100millionideas/projects" replace />} />
          <Route path="projects" element={<Projects />} />
          <Route path="project/:projectId" element={<ProjectDetail />} />
          <Route path="donate/:projectId" element={<DonateToProject />} />
          <Route path="donate-private-key/:projectId" element={<DonatePrivateKey />} />
          <Route path="donate-result" element={<DonateResult />} />
          <Route path="my-donations" element={<MyDonations />} />
        </Route>
        <Route path="/offline-lana" element={<OfflineLanaLayout />}>
          <Route index element={<Navigate to="/offline-lana/generate" replace />} />
          <Route path="generate" element={<GenerateWallet />} />
          <Route path="offline-wallets" element={<OfflineWallets />} />
        </Route>
        <Route path="/events" element={<LanaEventsLayout />}>
          <Route index element={<Navigate to="/events/online" replace />} />
          <Route path="online" element={<OnlineEvents />} />
          <Route path="live" element={<LiveEvents />} />
          <Route path="my" element={<MyEventsPage />} />
          <Route path="add" element={<AddEvent />} />
          <Route path="detail/:dTag" element={<EventDetail />} />
          <Route path="edit/:eventId" element={<EditEvent />} />
          <Route path="registrations/:dTag" element={<EventRegistrations />} />
          <Route path="donate/:dTag" element={<EventDonate />} />
          <Route path="donate-private-key/:dTag" element={<EventDonatePrivateKey />} />
          <Route path="donate-result" element={<EventDonateResult />} />
        </Route>
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
                    <Route index element={<Songs />} />
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
