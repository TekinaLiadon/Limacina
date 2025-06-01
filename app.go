package main

import (
	"Limacina/backend/auth"
	"Limacina/backend/minecraft"
	"Limacina/backend/utils"
	"context"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) GetFileList() (string, error) {
	return auth.GetFileList(a.ctx)
}

func (a *App) StartJvm() (string, error) {
	return minecraft.StartJvm("Break", "cabb620d78524907963fb7c0aaa97dc6", "5730aacc7d65c752b53ca07500e24735")
}

func (a *App) CheckDir() (string, error) {
	return utils.CheckDir()
}

/*
func SaveConfig(data interface{}, filePath string){
    file, err := os.Create(filePath + "/config.json")
        if err != nil {
            panic(err)
        }
        defer file.Close()

        encoder := json.NewEncoder(file)
        encoder.SetIndent("", "  ")
        err = encoder.Encode(data)
        if err != nil {
            panic(err)
        }
}

func (a *App) GetConfigInfo(url string) string {
    coreDir := a.CheckDir()
    CreateDir(coreDir + "/Lumacina")
    json := GetJson(url) // "http://localhost:3005/api/config"
    CreateDir(coreDir + "/Lumacina/" + json["name"])
    SaveConfig(coreDir + "/Lumacina")

    return json["name"]
} */
