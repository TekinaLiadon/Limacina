package utils

import (
	"os"
	"path/filepath"
)

func CheckDir() (string, error) {
	dirname, err := os.UserHomeDir()
	if err != nil {
		return "", CreateError(1000, err)
	}
	launcherName, flag := os.LookupEnv("LAUNCHER_NAME")
	if !flag {
		launcherName = "lumanicia"
	}
	dirname = filepath.Join(dirname, launcherName)
	_, err = os.Stat(dirname)
	if os.IsNotExist(err) {
		err = os.MkdirAll(dirname, 0755)
		if err != nil {
			return "", CreateError(1001, err)
		}
	} else if err != nil {
		return "", CreateError(1002, err)
	}
	return dirname, nil
}
