import Navbar from "@/components/ui/navbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto py-10">
        <div className="flex flex-col items-center text-center gap-8 max-w-3xl mx-auto mb-16">
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight ai-header">
            Welcome to Insight AI
          </h1>
          <p className="text-xl text-indigo-600">
            A powerful AI-driven analytics platform for your business needs
          </p>
          <div className="flex gap-4">
            <Button asChild size="lg" className="test-btn">
              <Link href="/dashboard">
                Get Started
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="hover:bg-slate-100 hover:border-indigo-300 transition-all duration-300">
              Learn More
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="colorful-card bg-gradient-to-br from-purple-50 to-indigo-50">
            <CardHeader>
              <CardTitle className="text-indigo-700">Advanced Analytics</CardTitle>
              <CardDescription className="text-indigo-500">Get in-depth insights</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Our AI-powered analytics provide you with deep insights into your business data, helping you make informed decisions.</p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="hover:bg-indigo-100 hover:text-indigo-700 transition-colors">Learn more</Button>
            </CardFooter>
          </Card>
          
          <Card className="colorful-card bg-gradient-to-br from-blue-50 to-cyan-50">
            <CardHeader>
              <CardTitle className="text-cyan-700">Real-time Tracking</CardTitle>
              <CardDescription className="text-cyan-500">Monitor performance</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Track key metrics in real-time and stay updated on everything important to your business.</p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="hover:bg-cyan-100 hover:text-cyan-700 transition-colors">Learn more</Button>
            </CardFooter>
          </Card>
          
          <Card className="colorful-card bg-gradient-to-br from-emerald-50 to-teal-50">
            <CardHeader>
              <CardTitle className="text-emerald-700">Customizable Dashboard</CardTitle>
              <CardDescription className="text-emerald-500">Tailor to your needs</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Create personalized dashboards that focus on the metrics that matter most to your organization.</p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="hover:bg-emerald-100 hover:text-emerald-700 transition-colors">Learn more</Button>
            </CardFooter>
          </Card>
        </div>
        
        <div className="mt-20 text-center">
          <h2 className="text-3xl font-bold mb-6 ai-header">Powered By Leading AI Technologies</h2>
          <div className="flex justify-center gap-8 flex-wrap">
            <div className="bg-white p-4 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 flex items-center space-x-2">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-indigo-600" fill="currentColor">
                <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
              </svg>
              <span className="font-semibold">Vercel AI SDK</span>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 flex items-center space-x-2">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-green-600" fill="currentColor">
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062l-4.793 2.77a4.5 4.5 0 0 1-6.187-1.626zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.767.767 0 0 0 .388.676l5.814 3.354-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.11 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.41 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.392.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
              </svg>
              <span className="font-semibold">Next.js</span>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 flex items-center space-x-2">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-blue-600" fill="currentColor">
                <path d="M18.5 22.5h-9a7.5 7.5 0 0 1 0-15h11a4.5 4.5 0 0 1 0 9h-10a1.5 1.5 0 0 1 0-3h9.5a.5.5 0 0 0 0-1h-9.5a2.5 2.5 0 0 0 0 5h10a5.5 5.5 0 0 0 0-11h-11a8.5 8.5 0 0 0 0 17h9a.5.5 0 0 0 0-1Z" />
              </svg>
              <span className="font-semibold">OpenAI</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
