import type { ResultPromise } from "execa";
import Conf from "conf";
export type ProcessStatus = "running" | "stopped" | "crashed";
export interface ProcessData {
    pid: number;
    command: string;
    cwd: string;
    status: ProcessStatus;
    startTime: number;
    autoShutdown: boolean;
    logFile?: string;
    errorOutput?: string;
}
export type ConfigSchema = {
    [cwd: string]: {
        [processKey: string]: ProcessData;
    };
};
export declare class ProcessManager {
    private config;
    private runningProcesses;
    private currentCwd;
    private monitoringInterval?;
    private logDir;
    private cleanupHandler;
    constructor(cwd?: string, configName?: string);
    private ensureLogDir;
    private cleanupStaleAutoShutdownProcesses;
    private generateProcessKey;
    private getLogFilePath;
    startProcess(command: string, autoShutdown?: boolean, cwd?: string, env?: Record<string, string>): Promise<number>;
    endProcess(pid: number): Promise<boolean>;
    private storeProcessData;
    private updateProcessData;
    private removeProcessData;
    private getProcessData;
    getCurrentCwdProcesses(): {
        [key: string]: ProcessData;
    };
    getProcessLogs(pid: number, tailLength?: number): Promise<string>;
    private startMonitoring;
    checkProcessHealth(): void;
    cleanup(): void;
    getConfig(): Conf<ConfigSchema>;
    getRunningProcesses(): Map<number, ResultPromise>;
    setCurrentCwd(cwd: string): void;
    getCurrentCwd(): string;
    getLogDir(): string;
}
//# sourceMappingURL=process-manager.d.ts.map