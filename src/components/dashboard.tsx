import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"

export function Dashboard() {
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Total Users</CardTitle>
            <CardDescription>User growth overview</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">1,248</p>
            <p className="text-xs text-muted-foreground">+12% from last month</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm">View details</Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Revenue</CardTitle>
            <CardDescription>Monthly revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">$34,567</p>
            <p className="text-xs text-muted-foreground">+8% from last month</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm">View details</Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Active Projects</CardTitle>
            <CardDescription>Current active projects</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">12</p>
            <p className="text-xs text-muted-foreground">+2 new this week</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm">View details</Button>
          </CardFooter>
        </Card>
      </div>
      
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Recent Activities</CardTitle>
          <CardDescription>Your recent activities across the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption>A list of your recent activities.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Apr 23, 2023</TableCell>
                <TableCell>Project Alpha created</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">View</Button>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Apr 22, 2023</TableCell>
                <TableCell>User onboarding</TableCell>
                <TableCell>In Progress</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">View</Button>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Apr 20, 2023</TableCell>
                <TableCell>Data import</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">View</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
} 