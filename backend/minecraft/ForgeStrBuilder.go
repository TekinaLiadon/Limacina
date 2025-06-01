package minecraft

import (
	"os"
	"path/filepath"
	"strings"
)

func GetClasspath(librariesDir string, forgeJar string, mcJar string) (string, error) {
	var jars []string

	err := filepath.Walk(librariesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".jar") {
			jars = append(jars, path)
		}
		return nil
	})
	if err != nil {
		return "", err
	}

	jars = append(jars, forgeJar, mcJar)

	sep := string(os.PathListSeparator)

	return strings.Join(jars, sep), nil
}
