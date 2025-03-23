'use client';

import React, { useState, useEffect } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, 
  Users, 
  DollarSign, 
  Briefcase, 
  Clock, 
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  BarChart3,
  PieChart,
  Activity
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { motion } from 'framer-motion';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface DashboardMetrics {
  totalUsers: number;
  totalRevenue: number;
  activeProjects: number;
  interviewsProcessed: number;
  averageSessionLength: number;
  userGrowth: number;
  revenueGrowth: number;
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalUsers: 0,
    totalRevenue: 0,
    activeProjects: 0,
    interviewsProcessed: 0,
    averageSessionLength: 0,
    userGrowth: 0,
    revenueGrowth: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      setLoading(true);
      
      try {
        // In a real app, you would fetch this data from your API
        // For now, we'll simulate a data fetch with sample data
        setTimeout(() => {
          setMetrics({
            totalUsers: 521,
            totalRevenue: 98450,
            activeProjects: 48,
            interviewsProcessed: 1284,
            averageSessionLength: 28,
            userGrowth: 12.5,
            revenueGrowth: 8.3
          });
          setLoading(false);
        }, 1000);
      } catch (error) {
        console.error('Error fetching dashboard metrics:', error);
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const renderSkeletonCard = () => (
    <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1"></div>
        <div className="h-6 w-20 bg-gray-300 rounded animate-pulse"></div>
      </CardHeader>
      <CardContent>
        <div className="h-8 w-full bg-gray-200 rounded animate-pulse"></div>
      </CardContent>
      <CardFooter>
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
      </CardFooter>
    </Card>
  );

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-gray-500 mt-1">Welcome to your InsightAI dashboard</p>
        </div>
        
        <div className="flex items-center gap-2 mt-4 sm:mt-0">
          <Button 
            variant="outline" 
            className="text-sm border-gray-200 bg-white shadow-sm hover:bg-gray-50"
          >
            Export
          </Button>
          <Button className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white">
            Generate Report
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {loading ? (
          <>
            {[1, 2, 3, 4].map((item) => (
              <div key={item}>{renderSkeletonCard()}</div>
            ))}
          </>
        ) : (
          <>
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="text-gray-500">Total Users</CardDescription>
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                      <Users className="h-4 w-4" />
                    </div>
                  </div>
                  <CardTitle className="text-2xl font-bold">{metrics.totalUsers}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center text-sm">
                    <div className={`flex items-center ${metrics.userGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {metrics.userGrowth >= 0 ? (
                        <ChevronUp className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      )}
                      <span>{Math.abs(metrics.userGrowth)}%</span>
                    </div>
                    <span className="text-gray-500 ml-1">from last month</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="text-gray-500">Total Revenue</CardDescription>
                    <div className="p-2 bg-green-100 text-green-600 rounded-full">
                      <DollarSign className="h-4 w-4" />
                    </div>
                  </div>
                  <CardTitle className="text-2xl font-bold">{formatCurrency(metrics.totalRevenue)}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center text-sm">
                    <div className={`flex items-center ${metrics.revenueGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {metrics.revenueGrowth >= 0 ? (
                        <ChevronUp className="h-4 w-4 mr-1" />
                      ) : (
                        <ChevronDown className="h-4 w-4 mr-1" />
                      )}
                      <span>{Math.abs(metrics.revenueGrowth)}%</span>
                    </div>
                    <span className="text-gray-500 ml-1">from last month</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
            >
              <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="text-gray-500">Active Projects</CardDescription>
                    <div className="p-2 bg-purple-100 text-purple-600 rounded-full">
                      <Briefcase className="h-4 w-4" />
                    </div>
                  </div>
                  <CardTitle className="text-2xl font-bold">{metrics.activeProjects}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center text-sm">
                    <span className="text-gray-500">Across {Math.round(metrics.totalUsers * 0.4)} companies</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
            >
              <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="text-gray-500">Interviews Processed</CardDescription>
                    <div className="p-2 bg-amber-100 text-amber-600 rounded-full">
                      <BarChart className="h-4 w-4" />
                    </div>
                  </div>
                  <CardTitle className="text-2xl font-bold">{metrics.interviewsProcessed}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center text-sm">
                    <span className="text-gray-500">Avg {metrics.averageSessionLength} min per session</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </div>

      {/* Tabs Section */}
      <Tabs defaultValue="overview" className="w-full">
        <div className="border-b border-gray-200 mb-6">
          <TabsList className="bg-transparent w-full justify-start h-auto p-0">
            <TabsTrigger 
              value="overview" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none rounded-none py-3 px-4 h-auto bg-transparent text-gray-600 hover:text-gray-900"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="analytics" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none rounded-none py-3 px-4 h-auto bg-transparent text-gray-600 hover:text-gray-900"
            >
              Analytics
            </TabsTrigger>
            <TabsTrigger 
              value="reports" 
              className="data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none rounded-none py-3 px-4 h-auto bg-transparent text-gray-600 hover:text-gray-900"
            >
              Reports
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Interview Insights</CardTitle>
                    <CardDescription>Monthly processed interviews with trend analysis</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="text-xs border-gray-200 bg-white">
                    View All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] flex items-center justify-center bg-gray-50 rounded-md border border-dashed border-gray-200">
                  <div className="text-center p-8">
                    <BarChart3 className="h-10 w-10 mb-4 text-indigo-200 mx-auto" />
                    <p className="text-sm text-gray-500">
                      Chart visualization would appear here in the production version
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Sentiment Distribution</CardTitle>
                    <CardDescription>Overall interview sentiment analysis</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs text-gray-500">
                    <ArrowUpRight className="h-3 w-3 mr-1" />
                    Details
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] flex items-center justify-center bg-gray-50 rounded-md border border-dashed border-gray-200">
                  <div className="text-center p-8">
                    <PieChart className="h-10 w-10 mb-4 text-indigo-200 mx-auto" />
                    <p className="text-sm text-gray-500">
                      Chart visualization would appear here in the production version
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Activity</CardTitle>
                    <CardDescription>Latest interview processing activity</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {loading ? (
                    Array(4).fill(0).map((_, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-full bg-gray-200 animate-pulse"></div>
                        <div className="flex-1">
                          <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse mb-2"></div>
                          <div className="h-3 w-1/2 bg-gray-100 rounded animate-pulse"></div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="space-y-4">
                      {[
                        { type: 'transcription', title: 'Customer Interview #1284', time: '12 min ago' },
                        { type: 'analysis', title: 'Product Feedback Session', time: '1 hour ago' },
                        { type: 'summary', title: 'UX Testing Results', time: '3 hours ago' },
                        { type: 'transcription', title: 'Feature Request Call', time: '5 hours ago' }
                      ].map((item, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <div className={`p-2 rounded-full 
                            ${item.type === 'transcription' ? 'bg-blue-100 text-blue-600' : 
                              item.type === 'analysis' ? 'bg-amber-100 text-amber-600' :
                              'bg-green-100 text-green-600'}`
                          }>
                            <Activity className="h-4 w-4" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="text-xs text-gray-500">{item.time}</p>
                          </div>
                          <Button variant="ghost" size="sm" className="text-xs h-auto py-1">
                            View
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="border-t bg-gray-50 hover:bg-gray-100 rounded-b-lg cursor-pointer transition-colors">
                <div className="w-full text-center">
                  <p className="text-sm text-gray-600">View all activity</p>
                </div>
              </CardFooter>
            </Card>

            <Card className="bg-white shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Top Pain Points</CardTitle>
                    <CardDescription>Most mentioned issues across interviews</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {loading ? (
                    Array(5).fill(0).map((_, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="h-4 w-1/3 bg-gray-200 rounded animate-pulse"></div>
                          <div className="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
                        </div>
                        <div className="h-2 bg-gray-200 rounded animate-pulse w-full"></div>
                      </div>
                    ))
                  ) : (
                    <div className="space-y-4">
                      {[
                        { issue: 'Slow loading times', mentions: 64, percentage: 85 },
                        { issue: 'Complex navigation', mentions: 51, percentage: 70 },
                        { issue: 'Lack of mobile support', mentions: 42, percentage: 60 },
                        { issue: 'Confusing pricing model', mentions: 38, percentage: 45 },
                        { issue: 'Limited export options', mentions: 29, percentage: 30 }
                      ].map((item, index) => (
                        <div key={index} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <div className="text-sm font-medium">{item.issue}</div>
                            <div className="text-xs text-gray-500">{item.mentions} mentions</div>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div 
                              className="bg-indigo-600 h-2 rounded-full" 
                              style={{ width: `${item.percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="border-t bg-gray-50 hover:bg-gray-100 rounded-b-lg cursor-pointer transition-colors">
                <div className="w-full text-center">
                  <p className="text-sm text-gray-600">View detailed analysis</p>
                </div>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-0">
          <div className="flex items-center justify-center h-64 border border-dashed border-gray-300 rounded-lg bg-gray-50">
            <p className="text-gray-500">Analytics content would be displayed here</p>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="mt-0">
          <div className="flex items-center justify-center h-64 border border-dashed border-gray-300 rounded-lg bg-gray-50">
            <p className="text-gray-500">Reports content would be displayed here</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}