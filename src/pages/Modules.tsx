import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { useModules } from "@/contexts/ModulesContext";
import { Button } from "@/components/ui/button";
import type { ModuleType } from "@/types/modules";

const UNREGISTERED_MODULE_IDS: Set<ModuleType> = new Set([
  'lanaknights', 'unregisteredwallets', 'lanamusic', 'tax',
  'lanapay', 'offlinelana', 'lanaevents', 'encryptedrooms',
  'chat', 'social', 'lanaexchange'
]);
export default function Modules() {
  const {
    getEnabledModules,
    modules
  } = useModules();
  const activeModules = getEnabledModules();
  const inactiveModules = modules.filter(mod => !mod.enabled).sort((a, b) => a.order - b.order);
  return <div className="max-w-7xl mx-auto">

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 mb-6">
        {activeModules.length === 0 ? <Card className="col-span-full">
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground mb-4">You have no active modules.</p>
              <Link to="/settings" className="text-primary hover:underline">
                Go to Settings to activate modules
              </Link>
            </CardContent>
          </Card> : activeModules.map(module => {
        const Icon = module.icon;
        const cardContent = <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer h-full">
                <CardContent className="p-0">
                  {module.image ? <div className="h-48 rounded-t-lg relative overflow-hidden">
                      <img src={module.image} alt={module.title} className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${module.imagePosition || ''}`} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    </div> : <div className={`h-48 bg-gradient-to-br ${module.gradient} rounded-t-lg flex items-center justify-center relative overflow-hidden`}>
                      <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
                      <Icon className="h-20 w-20 text-white relative z-10 group-hover:scale-110 transition-transform" />
                    </div>}
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-2xl font-bold">{module.title}</h3>
                        {!UNREGISTERED_MODULE_IDS.has(module.id) && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                            Reg
                          </Badge>
                        )}
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                    <p className="text-muted-foreground" dangerouslySetInnerHTML={{ __html: module.description }} />
                  </div>
                </CardContent>
              </Card>;
        return module.externalUrl ? <a key={module.path} href={module.externalUrl} target="_blank" rel="noopener noreferrer">
                {cardContent}
              </a> : <Link key={module.path} to={module.path}>
                {cardContent}
              </Link>;
      })}
      </div>

      {/* Inactive/Disabled Modules Section */}
      {inactiveModules.length > 0 && <div className="mt-12">
          <h2 className="text-2xl font-bold mb-4">Other Available Modules</h2>
          <div className="space-y-3">
            {inactiveModules.map(module => {
          const Icon = module.icon;
          const cardContent = <Card className="group hover:shadow-md transition-all duration-200 cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`h-12 w-12 rounded-lg bg-gradient-to-br ${module.gradient} flex items-center justify-center flex-shrink-0`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <h3 className="text-lg font-semibold">{module.title}</h3>
                        {!UNREGISTERED_MODULE_IDS.has(module.id) && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                            Reg
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: module.description }} />
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0" />
                  </CardContent>
                </Card>;
          return module.externalUrl ? <a key={module.path} href={module.externalUrl} target="_blank" rel="noopener noreferrer">
                  {cardContent}
                </a> : <Link key={module.path} to={module.path}>
                  {cardContent}
                </Link>;
        })}
          </div>
        </div>}

      <div className="text-center mt-8 mb-8">
        <Link to="/settings">
          <Button variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            Manage modules and order
          </Button>
        </Link>
      </div>
    </div>;
}