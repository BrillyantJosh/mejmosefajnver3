import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { KeyRound, Wallet, QrCode } from 'lucide-react';
import { NostrStatus } from '@/components/NostrStatus';
import { QRScanner } from '@/components/QRScanner';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import loginHero from '@/assets/login-hero.png';

const Login = () => {
  const [wif, setWif] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [rememberMe, setRememberMe] = useState(true); // Default to true for better UX
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { parameters } = useSystemParameters();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!wif.trim()) {
      toast({
        title: "Error",
        description: "Please enter your WIF private key",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
      await login(wif, parameters?.relays, rememberMe);
      toast({
        title: "Login successful",
        description: `Welcome to LanaCoin environment. Session valid for ${rememberMe ? '90' : '30'} days.`
      });
      navigate('/');
    } catch (error) {
      toast({
        title: "Login error",
        description: error instanceof Error ? error.message : "Invalid WIF key",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQRScan = (data: string) => {
    setWif(data);
    toast({
      title: "QR Code scanned",
      description: "Private key loaded from QR code"
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Hero Image - full width */}
      <div className="w-full">
        <img 
          src={loginHero}
          alt="Login Hero"
          className="w-full h-auto"
        />
      </div>
      
      {/* Login Card */}
      <div className="w-full px-4 py-8">
        <div className="max-w-md mx-auto">
          <Card className="bg-card/50 backdrop-blur border-border/50 shadow-2xl">
            <CardHeader className="space-y-3 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">LanaCoin Login</CardTitle>
              <CardDescription>
                Enter your WIF private key to access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wif" className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4" />
                    WIF Private Key
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="wif"
                      type="password"
                      placeholder="Enter WIF key..."
                      value={wif}
                      onChange={(e) => setWif(e.target.value)}
                      disabled={isLoading}
                      className="font-mono flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowQRScanner(true)}
                      disabled={isLoading}
                      title="Scan QR Code"
                    >
                      <QrCode className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your private key is safe and stored locally only
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                    disabled={isLoading}
                  />
                  <Label
                    htmlFor="rememberMe"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Remember me for 90 days (otherwise 30 days)
                  </Label>
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                >
                  {isLoading ? "Logging in..." : "Login"}
                </Button>
                
                <QRScanner 
                  isOpen={showQRScanner}
                  onClose={() => setShowQRScanner(false)}
                  onScan={handleQRScan}
                />
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* NostrStatus */}
      <div className="w-full px-4 pb-6">
        <div className="max-w-4xl mx-auto">
          <NostrStatus />
        </div>
      </div>
    </div>
  );
};

export default Login;
