import { Navbar } from "@/components/ui/navbar";
import { TextAnalyzer } from "@/components/ai/TextAnalyzer";
import { AudioTranscriber } from "@/components/ai/AudioTranscriber";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AIPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto py-10">
        <div className="flex flex-col gap-8">
          <div className="text-center">
            <h1 className="text-5xl font-bold tracking-tight mb-4 ai-header">AI Features</h1>
            <p className="text-xl text-indigo-600 max-w-2xl mx-auto">
              Explore the AI capabilities powered by Vercel AI SDK and OpenAI
            </p>
          </div>

          <Card className="colorful-card mx-auto max-w-3xl">
            <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-t-lg">
              <CardTitle className="text-2xl text-amber-700">Important Note</CardTitle>
              <CardDescription className="text-amber-600 font-medium">
                Before using these features, make sure to set your OpenAI API key
              </CardDescription>
            </CardHeader>
            <CardContent className="bg-gradient-to-b from-amber-50/50 to-transparent">
              <p className="text-gray-700">
                To use these AI features, you need to set up your OpenAI API key in the <code className="bg-amber-100 px-2 py-1 rounded text-amber-800 font-mono text-sm">.env.local</code> file:
              </p>
              <pre className="bg-gray-800 p-4 rounded-md mt-3 overflow-auto text-amber-300 font-mono">
                <code>OPENAI_API_KEY=your-openai-api-key</code>
              </pre>
            </CardContent>
          </Card>

          <div className="mt-8 mx-auto max-w-5xl w-full">
            <Tabs defaultValue="text" className="w-full">
              <TabsList className="mb-8 w-full justify-center gap-4 p-1">
                <TabsTrigger value="text" className="data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-800 px-6 py-3 text-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 inline" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9 1H7v2h6V6zm0 4H7v2h6v-2zm0 4H7v2h6v-2z" clipRule="evenodd" />
                  </svg>
                  Text Analysis
                </TabsTrigger>
                <TabsTrigger value="audio" className="data-[state=active]:bg-cyan-100 data-[state=active]:text-cyan-800 px-6 py-3 text-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 inline" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                  </svg>
                  Audio Transcription
                </TabsTrigger>
              </TabsList>
              <TabsContent value="text" className="border-0 p-0">
                <div className="colorful-card overflow-hidden">
                  <TextAnalyzer />
                </div>
              </TabsContent>
              <TabsContent value="audio" className="border-0 p-0">
                <div className="colorful-card overflow-hidden">
                  <AudioTranscriber />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
} 