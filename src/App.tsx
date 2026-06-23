import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ModulesProvider } from "./contexts/ModulesContext";
import { AdminProvider } from "./contexts/AdminContext";
import { AuthProvider } from "./contexts/AuthContext";
import { I18nProvider } from "./i18n/I18nContext";
import { SystemParametersProvider } from "./contexts/SystemParametersContext";
import { AdminProtectedRoute, ProtectedRoute } from "./components/ProtectedRoute";
import MainLayout from "./components/layout/MainLayout";
import ErrorBoundary from "./components/ErrorBoundary";
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Modules = lazy(() => import("./pages/Modules"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const VideoInstructions = lazy(() => import("./pages/VideoInstructions"));
const TaxCountries = lazy(() => import("./pages/tax/TaxCountries"));
const SocialLayout = lazy(() => import("./pages/social/SocialLayout"));
const Feed = lazy(() => import("./pages/social/Feed"));
const SocialHome = lazy(() => import("./pages/social/Home"));
const RoomFeed = lazy(() => import("./pages/social/RoomFeed"));
const UserProfile = lazy(() => import("./pages/social/UserProfile"));
const Rooms = lazy(() => import("./pages/social/Rooms"));
const TinyRooms = lazy(() => import("./pages/social/TinyRooms"));
const Comments = lazy(() => import("./pages/social/Comments"));
const LanaMusicLayout = lazy(() => import("./pages/music/LanaMusicLayout"));
const Songs = lazy(() => import("./pages/music/Songs"));
const Popular = lazy(() => import("./pages/music/Popular"));
const LashLayout = lazy(() => import("./pages/lash/LashLayout"));
const PayLashes = lazy(() => import("./pages/lash/PayLashes"));
const ReceivedLashes = lazy(() => import("./pages/lash/ReceivedLashes"));
const RelaysLayout = lazy(() => import("./pages/relays/RelaysLayout"));
const RelaysList = lazy(() => import("./pages/relays/RelaysList"));
const MyEvents = lazy(() => import("./pages/relays/MyEvents"));
const Kinds = lazy(() => import("./pages/relays/Kinds"));
const LanaPaysLayout = lazy(() => import("./pages/lanapays/LanaPaysLayout"));
const LanaPaysDiscover = lazy(() => import("./pages/lanapays/LanaPaysDiscover"));
const LanaPaysRedirect = lazy(() => import("./pages/lanapays/LanaPaysRedirect"));
const BusinessUnitDetail = lazy(() => import("./pages/lanapays/BusinessUnitDetail"));
const ListingDetail = lazy(() => import("./pages/lanapays/ListingDetail"));
const LanaTransparencyLayout = lazy(() => import("./pages/transparency/LanaTransparencyLayout"));
const TransparencyProfiles = lazy(() => import("./pages/transparency/Profiles"));
const TransparencyProfileDetail = lazy(() => import("./pages/transparency/ProfileDetail"));
const TransparencyWallets = lazy(() => import("./pages/transparency/Wallets"));
const TransparencyUnregisteredWallets = lazy(() => import("./pages/transparency/UnregisteredWallets"));
const TransparencyLast30 = lazy(() => import("./pages/transparency/Last30"));
const TransparencySearchByWallet = lazy(() => import("./pages/transparency/SearchByWallet"));
const DirectFundLayout = lazy(() => import("./pages/direct-fund/DirectFundLayout"));
const DirectFundPayments = lazy(() => import("./pages/direct-fund/PaymentsPage"));
const DirectFundBudgets = lazy(() => import("./pages/direct-fund/BudgetsPage"));
const UnconditionalPaymentLayout = lazy(() => import("./pages/unconditional-payment/UnconditionalPaymentLayout"));
const UnconditionalPaymentPending = lazy(() => import("./pages/unconditional-payment/Pending"));
const UnconditionalPaymentCompleted = lazy(() => import("./pages/unconditional-payment/Completed"));
const UnconditionalPaymentConfirmPayment = lazy(() => import("./pages/unconditional-payment/ConfirmPayment"));
const UnconditionalPaymentResult = lazy(() => import("./pages/unconditional-payment/Result"));
const UnconditionalPaymentRetryEvents = lazy(() => import("./pages/unconditional-payment/RetryEvents"));
const OwnLayout = lazy(() => import("./pages/own/OwnLayout"));
const Own = lazy(() => import("./pages/own/Own"));
const OwnSearch = lazy(() => import("./pages/own/Search"));
const OwnMyCases = lazy(() => import("./pages/own/MyCases"));
const OwnTranscript = lazy(() => import("./pages/own/Transcript"));
const StartOwnProcess = lazy(() => import("./pages/own/StartOwnProcess"));
const RockLayout = lazy(() => import("./pages/rock/RockLayout"));
const RockGrant = lazy(() => import("./pages/rock/Grant"));
const RockGrantNew = lazy(() => import("./pages/rock/GrantNew"));
const RockReceived = lazy(() => import("./pages/rock/Received"));
const UnregisteredWallets = lazy(() => import("./pages/unregistered-wallets/UnregisteredWallets"));
const MillionIdeasLayout = lazy(() => import("./pages/100millionideas/MillionIdeasLayout"));
const Projects = lazy(() => import("./pages/100millionideas/Projects"));
const ProjectDetail = lazy(() => import("./pages/100millionideas/ProjectDetail"));
const DonateToProject = lazy(() => import("./pages/100millionideas/DonateToProject"));
const DonatePrivateKey = lazy(() => import("./pages/100millionideas/DonatePrivateKey"));
const DonateResult = lazy(() => import("./pages/100millionideas/DonateResult"));
const MyDonations = lazy(() => import("./pages/100millionideas/MyDonations"));
const CreateProject = lazy(() => import("./pages/100millionideas/CreateProject"));
const MyProjects = lazy(() => import("./pages/100millionideas/MyProjects"));
const EditProject = lazy(() => import("./pages/100millionideas/EditProject"));
const BatchFunding = lazy(() => import("./pages/100millionideas/BatchFunding"));
const LanaEventsLayout = lazy(() => import("./pages/events/LanaEventsLayout"));
const OnlineEvents = lazy(() => import("./pages/events/OnlineEvents"));
const LiveEvents = lazy(() => import("./pages/events/LiveEvents"));
const PastEvents = lazy(() => import("./pages/events/PastEvents"));
const AddEvent = lazy(() => import("./pages/events/AddEvent"));
const EventDetail = lazy(() => import("./pages/events/EventDetail"));
const MyEventsPage = lazy(() => import("./pages/events/MyEvents"));
const EditEvent = lazy(() => import("./pages/events/EditEvent"));
const EventRegistrations = lazy(() => import("./pages/events/EventRegistrations"));
const EventDonate = lazy(() => import("./pages/events/EventDonate"));
const EventDonatePrivateKey = lazy(() => import("./pages/events/EventDonatePrivateKey"));
const EventDonateResult = lazy(() => import("./pages/events/EventDonateResult"));
const EventTicket = lazy(() => import("./pages/events/EventTicket"));
const EventCheckin = lazy(() => import("./pages/events/EventCheckin"));
const MyTickets = lazy(() => import("./pages/events/MyTickets"));
const MyCheckins = lazy(() => import("./pages/events/MyCheckins"));
const LanaAlignsWorldLayout = lazy(() => import("./pages/lanaalignsworld/LanaAlignsWorldLayout"));
const ActiveAlignments = lazy(() => import("./pages/lanaalignsworld/ActiveAlignments"));
const LanaAlignsWorldInfo = lazy(() => import("./pages/lanaalignsworld/Info"));
const MyStatus = lazy(() => import("./pages/lanaalignsworld/MyStatus"));
const EncryptedRoomsLayout = lazy(() => import("./pages/encrypted-rooms/EncryptedRoomsLayout"));
const EncryptedRoomList = lazy(() => import("./pages/encrypted-rooms/RoomList"));
const EncryptedRoomChat = lazy(() => import("./pages/encrypted-rooms/RoomChat"));
const BeingLayout = lazy(() => import("./pages/being/BeingLayout"));
const BeingChat = lazy(() => import("./pages/being/BeingChat"));
const BeingConversation = lazy(() => import("./pages/being/BeingConversation"));
const BeingVoice = lazy(() => import("./pages/being/BeingVoice"));
const BeingWorld = lazy(() => import("./pages/being/BeingWorld"));
const SplitWatcherLayout = lazy(() => import("./pages/split-watcher/SplitWatcherLayout"));
const SplitWatcherGeneral = lazy(() => import("./pages/split-watcher/SplitWatcherGeneral"));
const ReportLossLayout = lazy(() => import("./pages/report-loss/ReportLossLayout"));
const ReportForm = lazy(() => import("./pages/report-loss/ReportForm"));
const LossBoard = lazy(() => import("./pages/report-loss/LossBoard"));
const ShopLayout = lazy(() => import("./pages/shop/ShopLayout"));
const ShopSell = lazy(() => import("./pages/shop/ShopSell"));
const ShopPaid = lazy(() => import("./pages/shop/ShopPaid"));
const ShopPay = lazy(() => import("./pages/shop/ShopPay"));
const LanaDiscountLayout = lazy(() => import("./pages/discount/LanaDiscountLayout"));
const DiscountTransactions = lazy(() => import("./pages/discount/DiscountTransactions"));
const DiscountSell = lazy(() => import("./pages/discount/DiscountSell"));
const MeetLayout = lazy(() => import("./pages/meet/MeetLayout"));
const MeetJoin = lazy(() => import("./pages/meet/MeetJoin"));
const MeetSchedule = lazy(() => import("./pages/meet/MeetSchedule"));
const MeetSessions = lazy(() => import("./pages/meet/MeetSessions"));
const MeetRecordings = lazy(() => import("./pages/meet/MeetRecordings"));
const FoodCornerLayout = lazy(() => import("./pages/food-corner/FoodCornerLayout"));
const FoodCornerOrder = lazy(() => import("./pages/food-corner/FoodCornerOrder"));
const FoodCornerEcoPoint = lazy(() => import("./pages/food-corner/FoodCornerEcoPoint"));
const FoodCornerSupplier = lazy(() => import("./pages/food-corner/FoodCornerSupplier"));

const Chat = lazy(() => import("./pages/Chat"));
const Wallet = lazy(() => import("./pages/Wallet"));
const WalletConsolidate = lazy(() => import("./pages/WalletConsolidate"));
const RegisterWallet = lazy(() => import("./pages/RegisterWallet"));
const RegisterWalletResult = lazy(() => import("./pages/RegisterWalletResult"));
const SendLana = lazy(() => import("./pages/SendLana"));
const SendLanaRecipient = lazy(() => import("./pages/SendLanaRecipient"));
const SendLanaPrivateKey = lazy(() => import("./pages/SendLanaPrivateKey"));
const SendLanaResult = lazy(() => import("./pages/SendLanaResult"));
const SellLana = lazy(() => import("./pages/SellLana"));
const TestTransaction = lazy(() => import("./pages/TestTransaction"));
const BuyLana = lazy(() => import("./pages/BuyLana"));
const Lana8Wonder = lazy(() => import("./pages/Lana8Wonder"));
const Lana8WonderTransfer = lazy(() => import("./pages/Lana8WonderTransfer"));
const Lana8WonderLayout = lazy(() => import("./pages/lana8wonder/Lana8WonderLayout"));
const Lana8WonderSplits = lazy(() => import("./pages/lana8wonder/Lana8WonderSplits"));
const AiAdvisor = lazy(() => import("./pages/AiAdvisor"));
const Home = lazy(() => import("./pages/Home"));
const FaqDetail = lazy(() => import("./pages/FaqDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const BugReportsAdmin = lazy(() => import("./pages/admin/BugReports"));
const DatabaseBrowser = lazy(() => import("./pages/admin/DatabaseBrowser"));
const TrainAI = lazy(() => import("./pages/admin/TrainAI"));
const WhatsUpAdmin = lazy(() => import("./pages/admin/WhatsUpAdmin"));
const FaqAdmin = lazy(() => import("./pages/admin/FaqAdmin"));
const MillionIdeasAdmin = lazy(() => import("./pages/admin/MillionIdeasAdmin"));
const DiscountAdmin = lazy(() => import("./pages/admin/DiscountAdmin"));
const ReportBug = lazy(() => import("./pages/ReportBug"));
const PublicPost = lazy(() => import("./pages/PublicPost"));
const PublicEvent = lazy(() => import("./pages/PublicEvent"));
const PublicProposal = lazy(() => import("./pages/PublicProposal"));
const PublicHome = lazy(() => import("./pages/PublicHome"));
const PublicVideo = lazy(() => import("./pages/PublicVideo"));

const queryClient = new QueryClient();

// Fallback shown while a route's lazily-loaded chunk is being fetched.
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

// Redirect to external URL and navigate back to modules
const ExternalRedirect = ({ url }: { url: string }) => {
  window.location.href = url;
  return null;
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <SystemParametersProvider>
        <AuthProvider>
          <I18nProvider>
          <AdminProvider>
            <ModulesProvider>
              <TooltipProvider>
              <Toaster />
              <Sonner />
              <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/public" element={<PublicHome />} />
                <Route path="/post/:eventId" element={<PublicPost />} />
                <Route path="/event/:dTag" element={<PublicEvent />} />
                <Route path="/proposal/:dTag" element={<PublicProposal />} />
                <Route path="/video/:id" element={<PublicVideo />} />
                <Route element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }>
                  <Route path="/" element={<Home />} />
                  <Route path="/faq/:id" element={<FaqDetail />} />
                  <Route path="/ai-advisor" element={<AiAdvisor />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/modules" element={<Modules />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/video-instructions" element={<VideoInstructions />} />
                  <Route path="/report-bug" element={<ReportBug />} />
                  <Route path="/tax" element={<TaxCountries />} />
                  <Route path="/social" element={<SocialLayout />}>
                    <Route index element={<Navigate to="/social/feed" replace />} />
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
                  <Route path="/lanapays" element={<LanaPaysLayout />}>
                    <Route index element={<LanaPaysDiscover />} />
                    <Route path="pay" element={<LanaPaysRedirect />} />
                  </Route>
                  <Route path="/lanapays/unit/:unitId" element={<BusinessUnitDetail />} />
                  <Route path="/lanapays/listing/:pubkey/:listingId" element={<ListingDetail />} />
                  <Route path="/transparency" element={<LanaTransparencyLayout />}>
                    <Route index element={<TransparencyLast30 />} />
                    <Route path="last-30" element={<TransparencyLast30 />} />
                    <Route path="profiles" element={<TransparencyProfiles />} />
                    <Route path="profiles/:pubkey" element={<TransparencyProfileDetail />} />
                    <Route path="search-wallet" element={<TransparencySearchByWallet />} />
                    <Route path="wallets" element={<TransparencyWallets />} />
                    <Route path="unregistered-wallets" element={<TransparencyUnregisteredWallets />} />
                  </Route>
                  <Route path="/unconditional-payment" element={<UnconditionalPaymentLayout />}>
                    <Route index element={<UnconditionalPaymentPending />} />
                    <Route path="completed" element={<UnconditionalPaymentCompleted />} />
                    <Route path="retry" element={<UnconditionalPaymentRetryEvents />} />
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
          <Route path="create-project" element={<CreateProject />} />
          <Route path="my-projects" element={<MyProjects />} />
          <Route path="edit-project/:projectId" element={<EditProject />} />
          <Route path="batch-funding" element={<BatchFunding />} />
        </Route>
        <Route path="/offline-lana/*" element={<ExternalRedirect url="https://lanapaper.online" />} />
        <Route path="/events" element={<LanaEventsLayout />}>
          <Route index element={<Navigate to="/events/online" replace />} />
          <Route path="online" element={<OnlineEvents />} />
          <Route path="live" element={<LiveEvents />} />
          <Route path="past" element={<PastEvents />} />
          <Route path="my" element={<MyEventsPage />} />
          <Route path="add" element={<AddEvent />} />
          <Route path="detail/:dTag" element={<EventDetail />} />
          <Route path="edit/:eventId" element={<EditEvent />} />
          <Route path="registrations/:dTag" element={<EventRegistrations />} />
          <Route path="donate/:dTag" element={<EventDonate />} />
          <Route path="donate-private-key/:dTag" element={<EventDonatePrivateKey />} />
          <Route path="donate-result" element={<EventDonateResult />} />
          <Route path="ticket/:ticketId" element={<EventTicket />} />
          <Route path="checkin/:dTag" element={<EventCheckin />} />
          <Route path="my-tickets" element={<MyTickets />} />
          <Route path="my-checkins" element={<MyCheckins />} />
        </Route>
        <Route path="/lana-aligns-world" element={<LanaAlignsWorldLayout />}>
          <Route index element={<Navigate to="/lana-aligns-world/info" replace />} />
          <Route path="info" element={<LanaAlignsWorldInfo />} />
          <Route path="my-status" element={<MyStatus />} />
          <Route path="align" element={<ActiveAlignments />} />
          <Route path="active" element={<Navigate to="/lana-aligns-world/align" replace />} />
        </Route>
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/encrypted-rooms" element={<EncryptedRoomsLayout />}>
                    <Route index element={<EncryptedRoomList />} />
                    <Route path="room/:roomId" element={<EncryptedRoomChat />} />
                  </Route>
                  <Route path="/wallet" element={<Wallet />} />
                  <Route path="/wallet/consolidate/:walletId" element={<WalletConsolidate />} />
                  <Route path="/wallet/register" element={<RegisterWallet />} />
                  <Route path="/wallet/register/result" element={<RegisterWalletResult />} />
                  <Route path="/direct-fund" element={<DirectFundLayout />}>
                    <Route index element={<Navigate to="/direct-fund/payments" replace />} />
                    <Route path="payments" element={<DirectFundPayments />} />
                    <Route path="budgets" element={<DirectFundBudgets />} />
                  </Route>
                  <Route path="/send-lana" element={<SendLana />} />
            <Route path="/send-lana/recipient" element={<SendLanaRecipient />} />
            <Route path="/send-lana/private-key" element={<SendLanaPrivateKey />} />
            <Route path="/send-lana/result" element={<SendLanaResult />} />
                  <Route path="/sell-lana" element={<SellLana />} />
                  <Route path="/test-transaction" element={<TestTransaction />} />
                  <Route path="/buy-lana" element={<BuyLana />} />
                  <Route path="/lana8wonder" element={<Lana8WonderLayout />}>
                    <Route index element={<Lana8Wonder />} />
                    <Route path="splits" element={<Lana8WonderSplits />} />
                    <Route path="transfer" element={<Lana8WonderTransfer />} />
                  </Route>
                  <Route path="/ai-advisor" element={<AiAdvisor />} />
                  <Route path="/music" element={<LanaMusicLayout />}>
                    <Route index element={<Songs />} />
                    <Route path="popular" element={<Popular />} />
                  </Route>
                  <Route path="/being" element={<BeingLayout />}>
                    <Route path="chat/:pubkey" element={<BeingConversation />} />
                    <Route path="voice" element={<BeingVoice />} />
                    <Route path="world" element={<BeingWorld />} />
                  </Route>
                  <Route path="/split-watcher" element={<SplitWatcherLayout />}>
                    <Route index element={<SplitWatcherGeneral />} />
                    <Route path="general" element={<SplitWatcherGeneral />} />
                  </Route>
                  <Route path="/report-loss" element={<ReportLossLayout />}>
                    <Route index element={<ReportForm />} />
                    <Route path="board" element={<LossBoard />} />
                  </Route>
                  <Route path="/shop" element={<ShopLayout />}>
                    <Route index element={<Navigate to="/shop/sell" replace />} />
                    <Route path="sell" element={<ShopSell />} />
                    <Route path="paid" element={<ShopPaid />} />
                    <Route path="pay" element={<ShopPay />} />
                  </Route>
                  <Route path="/discount" element={<LanaDiscountLayout />}>
                    <Route index element={<Navigate to="/discount/transactions" replace />} />
                    <Route path="transactions" element={<DiscountTransactions />} />
                    <Route path="sell" element={<DiscountSell />} />
                  </Route>
                  <Route path="/meet" element={<MeetLayout />}>
                    <Route index element={<MeetJoin />} />
                    <Route path="schedule" element={<MeetSchedule />} />
                    <Route path="sessions" element={<MeetSessions />} />
                    <Route path="recordings" element={<MeetRecordings />} />
                  </Route>
                  <Route path="/food-corner" element={<FoodCornerLayout />}>
                    <Route index element={<FoodCornerOrder />} />
                    <Route path="eco-point" element={<FoodCornerEcoPoint />} />
                    <Route path="supplier" element={<FoodCornerSupplier />} />
                  </Route>
                  <Route
                    path="/admin"
                    element={
                      <AdminProtectedRoute>
                        <AdminLayout />
                      </AdminProtectedRoute>
                    }
                  >
                    <Route index element={<TrainAI />} />
                    <Route path="train-ai" element={<TrainAI />} />
                    <Route path="bug-reports" element={<BugReportsAdmin />} />
                    <Route path="database" element={<DatabaseBrowser />} />
                    <Route path="whats-up" element={<WhatsUpAdmin />} />
                    <Route path="faq" element={<FaqAdmin />} />
                    <Route path="100-million-ideas" element={<MillionIdeasAdmin />} />
                    <Route path="lana-discount" element={<DiscountAdmin />} />
                    <Route path="settings" element={<AdminSettings />} />
                  </Route>
                </Route>
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </TooltipProvider>
          </ModulesProvider>
        </AdminProvider>
          </I18nProvider>
      </AuthProvider>
      </SystemParametersProvider>
    </BrowserRouter>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
