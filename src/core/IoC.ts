/**
 * IOC - CONTAINER
 * ----------------------------------------
 *
 * Bind every controller and service to the ioc container. All controllers
 * will then be bonded to the express structure with their defined routes.
 */

import * as glob from 'glob';
import * as path from 'path';
import { Container, decorate, injectable } from 'inversify';
import { Types, Core, Targets } from '../constants';
import { events, EventEmitter } from './api/events';
import { Logger } from './Logger';
import { IocConfig } from '../config/IocConfig';


export class IoC {

    public container: Container;
    public libConfiguration: (container: Container) => Container;
    public customConfiguration: (container: Container) => Container;

    private log: Logger = new Logger(__filename);

    constructor() {
        this.container = new Container();
        const config = new IocConfig();
        config.configure(this);
    }

    public configure(configuration: (container: Container) => Container): void {
        this.customConfiguration = configuration;
    }

    public configureLib(configuration: (container: Container) => Container): void {
        this.libConfiguration = configuration;
    }

    public async bindModules(): Promise<void> {
        this.bindCore();

        if (this.libConfiguration) {
            this.container = this.libConfiguration(this.container);
        }

        await this.bindModels();
        await this.bindRepositories();
        await this.bindServices();

        await this.bindListeners();
        await this.bindMiddlewares();
        await this.bindControllers();

        if (this.customConfiguration) {
            this.container = this.customConfiguration(this.container);
        }
    }

    private bindCore(): void {
        this.container.bind<typeof Logger>(Types.Core).toConstantValue(Logger).whenTargetNamed(Core.Logger);
        this.container.bind<EventEmitter>(Types.Core).toConstantValue(events).whenTargetNamed(Core.Events);
    }

    private bindModels(): Promise<void> {
        return this.bindFiles('/models/**/*.ts', Targets.Model, (name: any, value: any) => {
            decorate(injectable(), value);
            this.container
                .bind<any>(Types.Model)
                .toConstantValue(value)
                .whenTargetNamed(name);
        });
    }

    private bindRepositories(): Promise<void> {
        return this.bindFiles(
            '/repositories/**/*Repository.ts',
            Targets.Repository,
            (name: any, value: any) => this.bindFile(Types.Repository, name, value));
    }

    private bindServices(): Promise<void> {
        return this.bindFiles(
            '/services/**/*Service.ts',
            Targets.Service,
            (name: any, value: any) => this.bindFile(Types.Service, name, value));
    }

    private bindMiddlewares(): Promise<void> {
        return this.bindFiles(
            '/middlewares/**/*Middleware.ts',
            Targets.Middleware,
            (name: any, value: any) => this.bindFile(Types.Middleware, name, value));
    }

    private bindControllers(): Promise<void> {
        return this.bindFiles(
            '/controllers/**/*Controller.ts',
            Targets.Controller,
            (name: any, value: any) => this.bindFile(Types.Controller, name, value));
    }

    private bindListeners(): Promise<void> {
        return this.bindFiles('/listeners/**/*Listener.ts', Targets.Listener, (name: any, value: any) => {
            decorate(injectable(), value);
            this.container
                .bind<any>(Types.Listener)
                .to(value)
                .whenTargetNamed(name);

            const listener: interfaces.Listener = this.container.getNamed<any>(Types.Listener, name);
            events.on(value.Event, (...args) => listener.act(...args));
        });
    }

    private bindFile(type: any, name: string, value: any): void {
        decorate(injectable(), value);
        this.container
            .bind<any>(type)
            .to(value)
            .whenTargetNamed(name);
    }

    private bindFiles(path: string, target: any, callback: (name: any, value: any) => void): Promise<void> {
        return new Promise<void>((resolve) => {
            this.getFiles(path, (files: string[]) => {
                files.forEach((file: any) => {
                    let fileExport;
                    let fileClass;
                    let fileTarget;
                    const isRecursive = file.name.indexOf('.') > 0;
                    try {
                        fileExport = require(`${file.path}`);
                    } catch (e) {
                        this.log.warn(e.message);
                        return;
                    }
                    if (fileExport === undefined) {
                        this.log.warn(`Could not find the file ${file.name}!`);
                        return;
                    }
                    if (isRecursive) {
                        fileClass = this.getClassOfFileExport(file.name, fileExport);
                        fileTarget = this.getTargetOfFile(file.name, target);

                    } else {
                        fileClass = fileExport[file.name];
                        fileTarget = target && target[file.name];
                    }

                    if (fileClass === undefined) {
                        this.log.warn(`Name of the file '${file.name}' does not match to the class name!`);
                        return;
                    }

                    if (fileTarget === undefined) {
                        this.log.warn(`Please define your '${file.name}' class is in the target constants.`);
                        return;
                    }

                    callback(fileTarget, fileClass);
                });
                resolve();
            });
        });
    }

    private getClassOfFileExport(name: string, fileExport: any): any {
        const fileParts = name.split('.');
        let fileClass = fileExport;
        fileParts.forEach((part) => {
            if (fileClass.hasOwnProperty(part)) {
                fileClass = fileClass[part];
            }
        });
        return fileClass;
    }

    private getTargetOfFile(name: string, target: any): any {
        const fileParts = name.split('.');
        let fileTarget = target;
        fileParts.forEach((part) => fileTarget = fileTarget[part]);
        return fileTarget;
    }

    private getBasePath(): string {
        const baseFolder = __dirname.indexOf('/src/') >= 0 ? '/src/' : '/dist/';
        const baseRoot = __dirname.substring(0, __dirname.indexOf(baseFolder));
        return path.join(baseRoot, baseFolder, 'api');
    }

    private getFiles(path: string, done: (files: any[]) => void): void {
        const isTypeScript = __dirname.indexOf('/src/') >= 0;
        if (!isTypeScript) {
            path = path.replace('.ts', '.js');
        }
        glob(this.getBasePath() + path, (err: any, files: string[]) => {
            if (err) {
                this.log.warn(`Could not read the folder ${path}!`);
                return;
            }
            done(files.map((p: string) => this.parseFilePath(p)));
        });
    }

    private parseFilePath(path: string): any {
        const filePath = path.substring(this.getBasePath().length + 1);
        const dir = filePath.split('/')[0];
        const file = filePath.substr(dir.length + 1);
        const name = file.replace('/', '.').substring(0, file.length - 3);
        return {
            path,
            filePath,
            dir,
            file,
            name
        };
    }

}
