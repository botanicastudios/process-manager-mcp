export declare class ProcessManagerCLI {
    private program;
    private processManager;
    constructor();
    private setupCommands;
    private startCommand;
    private listCommand;
    private stopCommand;
    private logsCommand;
    run(): Promise<void>;
    cleanup(): void;
}
export declare function runCLI(): Promise<void>;
//# sourceMappingURL=cli.d.ts.map