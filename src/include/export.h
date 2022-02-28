
#ifndef OMEGA_EDIT_EXPORT_H
#define OMEGA_EDIT_EXPORT_H

#ifdef OMEGA_EDIT_STATIC_DEFINE
#  define OMEGA_EDIT_EXPORT
#  define OMEGA_EDIT_NO_EXPORT
#else
#  ifndef OMEGA_EDIT_EXPORT
#    ifdef omega_edit_EXPORTS
        /* We are building this library */
#      define OMEGA_EDIT_EXPORT 
#    else
        /* We are using this library */
#      define OMEGA_EDIT_EXPORT 
#    endif
#  endif

#  ifndef OMEGA_EDIT_NO_EXPORT
#    define OMEGA_EDIT_NO_EXPORT 
#  endif
#endif

#ifndef OMEGA_EDIT_DEPRECATED
#  define OMEGA_EDIT_DEPRECATED __attribute__ ((__deprecated__))
#endif

#ifndef OMEGA_EDIT_DEPRECATED_EXPORT
#  define OMEGA_EDIT_DEPRECATED_EXPORT OMEGA_EDIT_EXPORT OMEGA_EDIT_DEPRECATED
#endif

#ifndef OMEGA_EDIT_DEPRECATED_NO_EXPORT
#  define OMEGA_EDIT_DEPRECATED_NO_EXPORT OMEGA_EDIT_NO_EXPORT OMEGA_EDIT_DEPRECATED
#endif

#if 0 /* DEFINE_NO_DEPRECATED */
#  ifndef OMEGA_EDIT_NO_DEPRECATED
#    define OMEGA_EDIT_NO_DEPRECATED
#  endif
#endif

#endif /* OMEGA_EDIT_EXPORT_H */
