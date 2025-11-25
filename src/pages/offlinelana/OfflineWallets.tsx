import { useEffect } from "react";

const OfflineWallets = () => {
  useEffect(() => {
    window.open('https://offlinelana.org/', '_blank');
  }, []);

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold mb-4">Redirecting to Offline Wallets</h1>
        <p className="text-muted-foreground mb-6">
          Opening offlinelana.org in a new tab...
        </p>
        <a 
          href="https://offlinelana.org/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          Click here if the page doesn't open automatically
        </a>
      </div>
    </div>
  );
};

export default OfflineWallets;
