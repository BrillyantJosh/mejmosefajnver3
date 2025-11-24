import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MyDonations = () => {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My Donations</h1>
        <p className="text-muted-foreground mt-2">
          Track your contributions and donations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Donations</CardTitle>
          <CardDescription>
            This is the My Donations page. Content will be added based on your specifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Your donation history will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default MyDonations;
