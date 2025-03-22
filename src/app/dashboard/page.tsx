import { Dashboard } from "@/components/dashboard"
import Navbar from "@/components/ui/navbar"

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <Dashboard />
    </div>
  )
} 